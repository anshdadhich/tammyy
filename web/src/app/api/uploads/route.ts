import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSessionUser, requireHrDb, requireOwnerDb } from "@/lib/auth-user";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { redactPii } from "@/lib/redact";
import {
  deleteObject,
  getObjectRange,
  isDuplicateObject,
  isObjectPath,
  objectHead,
  presignDownload,
  presignUpload,
  putObject,
  UPLOAD_PRESIGN_EXPIRES_IN,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_BUCKET = {
  resume: "resumes",
  photo: "photos",
  portfolio: "portfolios",
} as const;
type Kind = keyof typeof KIND_BUCKET;

const SHOW_COLUMN_BY_BUCKET = {
  resumes: "show_resume",
  photos: "show_photo",
  portfolios: "show_portfolio",
} as const;

const KIND_EXT: Record<Kind, readonly string[]> = {
  resume: ["pdf"],
  photo: ["jpg", "jpeg", "png"],
  portfolio: ["pdf", "jpg", "jpeg", "png"],
};

const FIXED_CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

const KIND_COLUMN = {
  resume: "resume_url",
  photo: "photo_url",
  portfolio: "portfolio_url",
} as const;

function err(message: string, status = 400, detail: unknown = null) {
  return Response.json({ error: message, detail }, { status });
}

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return clean || "file";
}

function hasActivePdfContent(bytes: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(bytes);
  const patterns = [
    "/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/EmbeddedFiles",
    "/AA", "/OpenAction", "/XFA", "/RichMedia", "/ObjStm",
  ];
  const lower = text.toLowerCase();
  if (lower.includes("<svg") || lower.includes("<script")) return true;
  for (const p of patterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

function sniffFile(ext: string, bytes: Uint8Array): { ok: boolean; reason?: string } {
  if (bytes.length < 8) return { ok: false, reason: "file too small" };
  const head = bytes;
  const asciiStart = new TextDecoder("latin1")
    .decode(bytes.slice(0, 512))
    .toLowerCase();
  if (asciiStart.includes("<svg") || asciiStart.includes("<?xml")) {
    return { ok: false, reason: "SVG content is not allowed" };
  }
  if (ext === "pdf") {
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
    if (!isPdf) return { ok: false, reason: "file content does not match its extension" };
    if (hasActivePdfContent(bytes)) {
      return { ok: false, reason: "PDF contains active content and was rejected" };
    }
    return { ok: true };
  }
  if (ext === "png") {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < sig.length; i++) {
      if (head[i] !== sig[i]) return { ok: false, reason: "file content does not match its extension" };
    }
    return { ok: true };
  }
  if (ext === "jpg" || ext === "jpeg") {
    const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (!isJpg) return { ok: false, reason: "file content does not match its extension" };
    const tail = bytes.slice(bytes.length - 2);
    if (!(tail[0] === 0xff && tail[1] === 0xd9)) {
      return { ok: false, reason: "truncated image content" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "unsupported extension" };
}

/**
 * Photo uploads go browser → R2 on a presigned PUT (zero Worker CPU, zero
 * egress), then POST { mode: "finalize" } verifies the stored object's
 * magic bytes and attaches it to the profile. Resume/portfolio downloads
 * keep the auth-checked same-origin route, and also offer presigned GETs
 * when R2 S3 credentials are configured.
 */
export async function POST(request: Request) {
  const rl = await rateLimit(request, { key: "uploads-post", limit: 20, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);

  const ct = request.headers.get("content-type") ?? "";
  if (ct.toLowerCase().includes("application/json")) {
    return handleJsonUpload(request);
  }
  return handleProxyUpload(request);
}

async function handleJsonUpload(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = typeof b.mode === "string" ? b.mode : "request-upload";
  const kind = typeof b.kind === "string" ? b.kind : "";
  const candidateId = typeof b.candidate_id === "string" ? b.candidate_id.trim() : "";

  if (kind !== "resume" && kind !== "photo" && kind !== "portfolio") {
    return err('kind must be "resume", "photo", or "portfolio"');
  }
  if (!UUID_RE.test(candidateId)) {
    return err("candidate_id must be a valid uuid");
  }

  const session = await getSessionUser();
  const viewer = session?.viewer ?? { kind: "anon" as const };
  if (viewer.kind === "anon") return err("Sign in to upload files.", 401);
  if (viewer.kind === "hr") return err("Employers cannot upload profile files.", 403);
  const gate = await requireOwnerDb(candidateId, session);
  if (gate instanceof Response) return err("You can only upload files to your own profile.", gate.status);

  const db = await getDb();
  const candRows = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(eq(schema.candidates.id, candidateId))
    .limit(1);
  if (!candRows[0]) return err("candidate not found", 404);

  const filename =
    typeof b.filename === "string" && b.filename.trim()
      ? sanitizeFilename(b.filename.trim())
      : "upload";
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!KIND_EXT[kind].includes(ext)) {
    return err(`invalid extension for ${kind}: expected ${KIND_EXT[kind].join(" / ")}`);
  }
  const size = Number(b.size ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return err(`file size must be between 1 byte and ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB`);
  }
  const contentType = FIXED_CONTENT_TYPE[ext] ?? "application/octet-stream";
  const bucket = KIND_BUCKET[kind];
  const path = `${candidateId}/${Date.now()}-${filename}`;

  if (mode === "finalize") {
    const head = await objectHead(bucket, path);
    if (!head) return err("uploaded file not found", 404);
    if (head.size > MAX_BYTES) {
      await deleteObject(bucket, path);
      return err("file too large: exceeds 10MB");
    }
    const headBytes = await getObjectRange(bucket, path, { offset: 0, length: 512 });
    const tailBytes =
      ext === "jpg" || ext === "jpeg"
        ? await getObjectRange(bucket, path, { suffix: 2 })
        : null;
    const probe = new Uint8Array((headBytes?.length ?? 0) + (tailBytes?.length ?? 0));
    if (headBytes) probe.set(headBytes, 0);
    if (tailBytes) probe.set(tailBytes, headBytes?.length ?? 0);
    const sniffed = sniffFile(ext, probe);
    if (!sniffed.ok) {
      await deleteObject(bucket, path);
      return err(sniffed.reason ?? "file content rejected");
    }
    await attachToProfile(candidateId, kind, path, db);
    return Response.json(
      { bucket, path, signedUrl: downloadUrl(bucket, path), expiresIn: 0 },
      { status: 201 },
    );
  }

  const uploadUrl = await presignUpload(bucket, path);
  if (uploadUrl) {
    return Response.json(
      {
        mode: "presigned",
        bucket,
        path,
        uploadUrl,
        method: "PUT",
        headers: { "content-type": contentType },
        expiresInSeconds: UPLOAD_PRESIGN_EXPIRES_IN,
      },
      { status: 201 },
    );
  }

  // No R2 S3 credentials configured — fall back to a Worker-mediated PUT
  // so local dev keeps working (the direct-to-R2 path is the prod one).
  return Response.json(
    {
      mode: "direct",
      bucket,
      path,
      uploadUrl: `/api/uploads?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`,
      method: "PUT",
      headers: { "content-type": contentType },
      expiresInSeconds: 0,
    },
    { status: 201 },
  );
}

async function attachToProfile(
  candidateId: string,
  kind: Kind,
  path: string,
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<void> {
  const column = KIND_COLUMN[kind];
  await db
    .update(schema.candidates)
    .set({ [column]: path, updated_at: new Date().toISOString() })
    .where(eq(schema.candidates.id, candidateId));
}

function downloadUrl(bucket: string, path: string): string {
  return `/api/uploads?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

async function handleProxyUpload(request: Request): Promise<Response> {
  const clRaw = request.headers.get("content-length");
  if (clRaw !== null) {
    const cl = Number(clRaw);
    if (Number.isFinite(cl) && cl > MAX_BYTES + 1024 * 1024) {
      return err("file too large: exceeds 10MB");
    }
  }
  const url = new URL(request.url);
  const putBucket = url.searchParams.get("bucket") ?? "";
  const putPath = url.searchParams.get("path") ?? "";

  if (request.method === "PUT" && putBucket && putPath) {
    return handleDirectPut(request, putBucket, putPath);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("expected multipart/form-data", 400);
  }

  const session = await getSessionUser();
  const viewer = session?.viewer ?? { kind: "anon" as const };
  const kindRaw = form.get("kind");
  const candidateIdRaw = form.get("candidate_id");
  const file = form.get("file");

  const kind = typeof kindRaw === "string" ? kindRaw : "";
  if (kind !== "resume" && kind !== "photo" && kind !== "portfolio") {
    return err('kind must be "resume", "photo", or "portfolio"');
  }
  const candidateId =
    typeof candidateIdRaw === "string" ? candidateIdRaw.trim() : "";
  if (!UUID_RE.test(candidateId)) {
    return err("candidate_id must be a valid uuid");
  }
  if (viewer.kind === "anon") {
    return err("Sign in to upload files.", 401);
  }
  if (viewer.kind === "hr") {
    return err("Employers cannot upload profile files.", 403);
  }
  if (viewer.kind === "owner") {
    const gate = await requireOwnerDb(candidateId, session);
    if (gate instanceof Response) return err("You can only upload files to your own profile.", gate.status);
  }
  if (!(file instanceof File)) {
    return err("file is required");
  }
  if (file.size <= 0) return err("file is empty");
  if (file.size > MAX_BYTES) {
    return err(
      `file too large: ${(file.size / 1024 / 1024).toFixed(1)}MB > 10MB`,
    );
  }
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!KIND_EXT[kind].includes(ext)) {
    return err(`invalid extension for ${kind}: expected ${KIND_EXT[kind].join(" / ")}`);
  }
  let bytes: Uint8Array;
  try {
    const buf = await file.arrayBuffer();
    bytes = new Uint8Array(buf);
  } catch {
    return err("could not read file");
  }
  if (bytes.length > MAX_BYTES) {
    return err("file too large: exceeds 10MB");
  }
  if (bytes.length === 0) return err("file is empty");
  const sniffed = sniffFile(ext, bytes);
  if (!sniffed.ok) return err(sniffed.reason ?? "file content rejected");

  const bucket = KIND_BUCKET[kind];
  const path = `${candidateId}/${Date.now()}-${sanitizeFilename(file.name)}`;

  const db = await getDb();
  const candRows = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(eq(schema.candidates.id, candidateId))
    .limit(1);
  if (!candRows[0]) return err("candidate not found", 404);

  try {
    await putObject(bucket, path, bytes);
  } catch (e) {
    if (isDuplicateObject(e)) return err("upload failed", 409);
    console.error("[uploads] storage upload failed", redactPii(bucket));
    return err("upload failed", 500);
  }

  try {
    await attachToProfile(candidateId, kind, path, db);
  } catch {
    console.error("[uploads] profile link failed — removing orphan object", redactPii(bucket));
    try {
      await deleteObject(bucket, path);
    } catch {
    }
    return err("upload failed to attach to profile", 500);
  }

  return Response.json(
    { bucket, path, signedUrl: downloadUrl(bucket, path), expiresIn: 0 },
    { status: 201 },
  );
}

async function handleDirectPut(
  request: Request,
  bucketRaw: string,
  pathRaw: string,
): Promise<Response> {
  if (bucketRaw !== "resumes" && bucketRaw !== "photos" && bucketRaw !== "portfolios") {
    return err("bucket must be resumes, photos, or portfolios");
  }
  if (!isObjectPath(pathRaw) || pathRaw.includes("..")) {
    return err("path must be {candidate_uuid}/{filename}");
  }
  const folderId = pathRaw.split("/")[0] ?? "";
  const session = await getSessionUser();
  const viewer = session?.viewer ?? { kind: "anon" as const };
  if (viewer.kind === "anon") return err("Sign in to upload files.", 401);
  if (viewer.kind === "hr") return err("Employers cannot upload profile files.", 403);
  const gate = await requireOwnerDb(folderId, session);
  if (gate instanceof Response) return err("You can only upload files to your own profile.", gate.status);

  const body = request.body;
  if (!body) return err("empty upload body");
  try {
    await putObject(bucketRaw, pathRaw, body);
  } catch (e) {
    if (isDuplicateObject(e)) return err("upload failed", 409);
    console.error("[uploads] direct put failed", redactPii(bucketRaw));
    return err("upload failed", 500);
  }
  return Response.json({ bucket: bucketRaw, path: pathRaw }, { status: 201 });
}

export async function GET(request: Request) {
  const rl = await rateLimit(request, { key: "uploads-get", limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket") ?? "";
  const path = url.searchParams.get("path") ?? "";

  if (
    bucket !== "resumes" &&
    bucket !== "photos" &&
    bucket !== "portfolios"
  ) {
    return err("bucket must be resumes, photos, or portfolios");
  }
  if (!isObjectPath(path) || path.includes("..")) {
    return err("path must be {candidate_uuid}/{filename}");
  }

  const session = await getSessionUser();
  const viewer = session?.viewer ?? { kind: "anon" as const };
  const folderId = path.split("/")[0] ?? "";
  if (viewer.kind === "anon") {
    return err("Sign in to view files.", 401);
  }
  if (viewer.kind === "owner") {
    const gate = await requireOwnerDb(folderId, session);
    if (gate instanceof Response) return err("You can only view your own files.", gate.status);
  }

  if (viewer.kind === "hr") {
    const hr = await requireHrDb(session);
    if (hr instanceof Response) return hr;
    const showColumn = SHOW_COLUMN_BY_BUCKET[bucket as keyof typeof SHOW_COLUMN_BY_BUCKET];
    const db = await getDb();
    const candRows = await db
      .select({
        visibility_status: schema.candidates.visibility_status,
        show_resume: schema.candidates.show_resume,
        show_portfolio: schema.candidates.show_portfolio,
        show_photo: schema.candidates.show_photo,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, folderId))
      .limit(1);
    const cand = candRows[0];
    if (
      !cand ||
      cand.visibility_status !== "visible" ||
      cand[showColumn] !== true
    ) {
      return err("candidate not found", 404);
    }
    try {
      const entitled = await employerEntitled(db, folderId, hr.employerId);
      if (!entitled) {
        return err("no access to these files", 403);
      }
    } catch {
      return err("no access to these files", 403);
    }
  }

  try {
    const db = await getDb();
    await db.insert(schema.auditLogs).values({
      id: randomUUID(),
      action: "file_view",
      target_type: bucket,
      target_id: folderId,
      metadata_json: { path, bucket },
    });
  } catch {
  }

  const head = await objectHead(bucket, path);
  if (!head) return err("file not found", 404);

  const presigned = await presignDownload(bucket, path);
  if (presigned) {
    return Response.json({ signedUrl: presigned, expiresIn: 900 });
  }

  const bytes = await getObjectRange(bucket, path, { offset: 0, length: head.size });
  if (!bytes) return err("file not found", 404);
  const downloadName = path.split("/").pop() ?? "download";
  const fileExt = (downloadName.split(".").pop() ?? "").toLowerCase();
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": FIXED_CONTENT_TYPE[fileExt] ?? "application/octet-stream",
      "content-disposition": `inline; filename="${downloadName}"`,
      "cache-control": "private, max-age=300",
    },
  });
}

async function employerEntitled(
  db: Awaited<ReturnType<typeof getDb>>,
  candidateId: string,
  employerId: string,
): Promise<boolean> {
  const { and, eq, inArray } = await import("drizzle-orm");
  const sl = await db
    .select({ id: schema.shortlists.id })
    .from(schema.shortlists)
    .where(
      and(
        eq(schema.shortlists.candidate_id, candidateId),
        eq(schema.shortlists.employer_id, employerId),
      ),
    )
    .limit(1);
  if (sl[0]) return true;
  const cl = await db
    .select({ id: schema.contactLog.id })
    .from(schema.contactLog)
    .where(
      and(
        eq(schema.contactLog.candidate_id, candidateId),
        eq(schema.contactLog.employer_id, employerId),
      ),
    )
    .limit(1);
  if (cl[0]) return true;
  const matchRows = await db
    .select({ search_id: schema.candidateMatches.search_id })
    .from(schema.candidateMatches)
    .where(eq(schema.candidateMatches.candidate_id, candidateId))
    .limit(50);
  const matchedSearchIds = matchRows
    .map((m) => m.search_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (!matchedSearchIds.length) return false;
  const own = await db
    .select({ id: schema.searches.id })
    .from(schema.searches)
    .where(
      and(
        inArray(schema.searches.id, matchedSearchIds),
        eq(schema.searches.employer_id, employerId),
      ),
    )
    .limit(1);
  return !!own[0];
}
