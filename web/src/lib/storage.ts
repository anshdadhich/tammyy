import { AwsClient } from "aws4fetch";
import { cfEnv } from "@/lib/cf";

export const STORAGE_BUCKETS = ["resumes", "photos", "portfolios"] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export function isStorageBucket(v: unknown): v is StorageBucket {
  return typeof v === "string" && (STORAGE_BUCKETS as readonly string[]).includes(v);
}

/**
 * `{candidate_uuid}/{filename}` — single level, no traversal, no absolute
 * paths. Access control lives in the route (`/api/uploads`), not in the URL.
 */
export function isObjectPath(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.includes("..") || v.includes("\\") || v.startsWith("/")) return false;
  const re =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,200}$/i;
  const parts = v.split("/");
  if (parts.length !== 2) return false;
  return re.test(parts[0]) && /^[A-Za-z0-9._-]{1,200}$/.test(parts[1]);
}

function objectKey(bucket: StorageBucket, objectPath: string): string {
  if (!isStorageBucket(bucket)) throw new Error("unknown storage bucket");
  if (!isObjectPath(objectPath)) throw new Error("invalid object path");
  return `${bucket}/${objectPath}`;
}

class StorageNotConfiguredError extends Error {
  constructor() {
    super("file storage is not configured yet (R2 pending account enablement)");
    this.name = "StorageNotConfiguredError";
  }
}

async function media(): Promise<R2Bucket> {
  const env = await cfEnv();
  if (!env.MEDIA) throw new StorageNotConfiguredError();
  return env.MEDIA;
}

export function isStorageNotConfigured(e: unknown): boolean {
  return e instanceof StorageNotConfiguredError;
}

export async function putObject(
  bucket: StorageBucket,
  objectPath: string,
  bytes: Uint8Array | ReadableStream,
): Promise<void> {
  const key = objectKey(bucket, objectPath);
  const store = await media();
  const existing = await store.head(key);
  if (existing) {
    const e = new Error("object already exists");
    (e as { code?: string }).code = "EEXIST";
    throw e;
  }
  await store.put(key, bytes as unknown as Parameters<R2Bucket["put"]>[1]);
}

export async function getObject(bucket: StorageBucket, objectPath: string): Promise<ArrayBuffer | null> {
  const key = objectKey(bucket, objectPath);
  const store = await media();
  const obj = await store.get(key);
  return obj ? await obj.arrayBuffer() : null;
}

export async function getObjectRange(
  bucket: StorageBucket,
  objectPath: string,
  range: { offset: number; length: number } | { suffix: number },
): Promise<Uint8Array | null> {
  const key = objectKey(bucket, objectPath);
  const store = await media();
  const obj = await store.get(key, {
    range:
      "suffix" in range
        ? { suffix: range.suffix }
        : { offset: range.offset, length: range.length },
  });
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

export async function objectHead(
  bucket: StorageBucket,
  objectPath: string,
): Promise<{ size: number; contentType: string | null } | null> {
  const key = objectKey(bucket, objectPath);
  const store = await media();
  const obj = await store.head(key);
  return obj ? { size: obj.size, contentType: obj.httpMetadata?.contentType ?? null } : null;
}

export async function deleteObject(bucket: StorageBucket, objectPath: string): Promise<void> {
  try {
    const key = objectKey(bucket, objectPath);
    const store = await media();
    await store.delete(key);
  } catch (e) {
    if (e instanceof Error && /invalid object path|unknown storage bucket/.test(e.message)) return;
    throw e;
  }
}

export function isDuplicateObject(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "EEXIST";
}

const PRESIGN_EXPIRY_SECONDS = 15 * 60;

function presignDisabled(): boolean {
  return !(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ACCOUNT_ID);
}

/**
 * Presigned PUT so image bytes go browser → R2 directly and never occupy
 * Worker CPU (formData parsing of a multi-MB upload blows the free plan's
 * 10ms budget). Requires R2 S3 API credentials; without them the route
 * falls back to a Worker-mediated upload so local dev keeps working.
 */
export async function presignUpload(
  bucket: StorageBucket,
  objectPath: string,
): Promise<string | null> {
  if (presignDisabled()) return null;
  const key = objectKey(bucket, objectPath);
  const account = process.env.R2_ACCOUNT_ID!;
  const client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  });
  const url = new URL(
    `https://${account}.r2.cloudflarestorage.com/${process.env.R2_BUCKET_NAME ?? "tammy-media"}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRY_SECONDS));
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function presignDownload(
  bucket: StorageBucket,
  objectPath: string,
  expiresInSeconds = PRESIGN_EXPIRY_SECONDS,
): Promise<string | null> {
  if (presignDisabled()) return null;
  const key = objectKey(bucket, objectPath);
  const account = process.env.R2_ACCOUNT_ID!;
  const client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  });
  const url = new URL(
    `https://${account}.r2.cloudflarestorage.com/${process.env.R2_BUCKET_NAME ?? "tammy-media"}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

export const UPLOAD_PRESIGN_EXPIRES_IN = PRESIGN_EXPIRY_SECONDS;
