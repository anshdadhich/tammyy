import { cfEnv } from "@/lib/cf";

// qwen3-embedding-0.6b is Matryoshka-trained (MRL): its 1024-dim output can
// be safely truncated to a 512-dim prefix with graceful quality loss. This
// halves Vectorize storage versus 1024d while keeping m3-tier recall.
export const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const EMBEDDING_DIM = 512;
const NATIVE_DIM = 1024;
export const EMBEDDING_TIMEOUT_MS = 20_000;
const MAX_BATCH = 100;

function truncateMrl(vec: number[]): number[] {
  return vec.length === EMBEDDING_DIM ? vec : vec.slice(0, EMBEDDING_DIM);
}

function assertEmbeddingDim(vec: unknown, expected = EMBEDDING_DIM): asserts vec is number[] {
  if (!Array.isArray(vec) || vec.length !== expected) {
    throw new Error(
      `Embedding dim mismatch: got ${Array.isArray(vec) ? vec.length : typeof vec}, expected ${expected}`,
    );
  }
  for (const v of vec) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Embedding contains non-finite value, expected ${expected} finite numbers`);
    }
  }
}

type AiEmbeddingResponse = {
  data: number[][];
  shape?: number[];
};

async function embedBatch(texts: string[]): Promise<number[][]> {
  const env = await cfEnv();
  const run = env.AI.run(EMBEDDING_MODEL as never, {
    text: texts,
  } as never);
  const res = (await Promise.race([
    run,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("embedding timed out")), EMBEDDING_TIMEOUT_MS),
    ),
  ])) as unknown;
  const parsed = res as unknown as AiEmbeddingResponse;
  if (!parsed?.data || parsed.data.length !== texts.length) {
    throw new Error("embedding response malformed");
  }
  return parsed.data.map((raw) => {
    if (!Array.isArray(raw) || (raw.length !== NATIVE_DIM && raw.length !== EMBEDDING_DIM)) {
      throw new Error(`unexpected embedding width: ${Array.isArray(raw) ? raw.length : typeof raw}`);
    }
    const vec = truncateMrl(raw);
    assertEmbeddingDim(vec);
    return vec;
  });
}

/**
 * Returns one vector per input, in input order — callers zip results back to
 * their inputs, so blank strings are an error rather than a silent drop.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (texts.some((t) => !t.trim())) {
    throw new Error("embedTexts: blank input would break index alignment");
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    out.push(...(await embedBatch(texts.slice(i, i + MAX_BATCH))));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text.trim()]);
  return vec;
}
