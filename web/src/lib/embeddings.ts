import { cfEnv } from "@/lib/cf";

export const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
export const EMBEDDING_DIM = 384;
export const EMBEDDING_TIMEOUT_MS = 20_000;
const MAX_BATCH = 100;

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
  const res = await env.AI.run(EMBEDDING_MODEL as never, {
    text: texts,
  } as never);
  const parsed = res as unknown as AiEmbeddingResponse;
  if (!parsed?.data || parsed.data.length !== texts.length) {
    throw new Error("embedding response malformed");
  }
  for (const vec of parsed.data) assertEmbeddingDim(vec);
  return parsed.data;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const clean = texts.map((t) => t.trim()).filter(Boolean);
  if (!clean.length) return [];
  const out: number[][] = [];
  for (let i = 0; i < clean.length; i += MAX_BATCH) {
    out.push(...(await embedBatch(clean.slice(i, i + MAX_BATCH))));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text.trim()]);
  return vec;
}
