import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

/**
 * Local-disk object storage (replaces Supabase Storage buckets).
 *
 * Layout: `<root>/<bucket>/<candidate_uuid>/<filename>`
 *   - root = process.env.STORAGE_DIR when set, else `<cwd>/storage`
 *   - buckets mirror the old Supabase buckets one-to-one
 *
 * Paths stored in Mongo (`candidates.resume_url` etc.) stay the bare
 * `{uuid}/{filename}` value — exactly what the old code stored — so the
 * existing "is this a storage path or an http link?" checks keep working.
 * Access control lives in the route (`/api/uploads`), not in the URL:
 * every download re-checks the session, which is stronger than the old
 * expiring signed URLs.
 */

export const STORAGE_BUCKETS = ["resumes", "photos", "portfolios"] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export function isStorageBucket(v: unknown): v is StorageBucket {
  return typeof v === "string" && (STORAGE_BUCKETS as readonly string[]).includes(v);
}

/**
 * `{candidate_uuid}/{filename}` — single level, no traversal, no absolute
 * paths. Mirrors the old route-level PATH_RE contract.
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

function storageRoot(): string {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.join(process.cwd(), "storage");
}

function resolveObject(bucket: StorageBucket, objectPath: string): string {
  if (!isStorageBucket(bucket)) throw new Error("unknown storage bucket");
  if (!isObjectPath(objectPath)) throw new Error("invalid object path");
  const root = storageRoot();
  const full = path.resolve(root, bucket, objectPath);
  // Defense in depth: the resolved file must live under the root.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("object path escapes storage root");
  }
  return full;
}

/** True for Node EEXIST errors thrown by `putObject`. */
export function isDuplicateObject(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "EEXIST";
}

/**
 * Write an object. Fails when the file already exists (mirrors the old
 * `upsert: false` upload option) so callers can map EEXIST → 409.
 */
export async function putObject(
  bucket: StorageBucket,
  objectPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const full = resolveObject(bucket, objectPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { flag: "wx" });
}

/** Read an object; null when it does not exist. */
export async function getObject(
  bucket: StorageBucket,
  objectPath: string,
): Promise<Buffer | null> {
  const full = resolveObject(bucket, objectPath);
  try {
    return await readFile(full);
  } catch (e) {
    if ((e as { code?: string })?.code === "ENOENT") return null;
    throw e;
  }
}

/** Delete an object; missing files are a no-op (mirrors `remove()`). */
export async function deleteObject(
  bucket: StorageBucket,
  objectPath: string,
): Promise<void> {
  try {
    const full = resolveObject(bucket, objectPath);
    await unlink(full);
  } catch (e) {
    if ((e as { code?: string })?.code === "ENOENT") return;
    if (e instanceof Error && /invalid object path|unknown storage bucket/.test(e.message)) return;
    throw e;
  }
}

/** Same-origin URL served by GET /api/uploads (auth enforced per request). */
export function objectUrl(bucket: StorageBucket, objectPath: string): string {
  return `/api/uploads?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(objectPath)}`;
}
