import { createHmac, timingSafeEqual } from "node:crypto";
import { getSessionUser, requireOwnerDb } from "@/lib/auth-user";

export type Viewer =
  | { kind: "hr"; name: string; email: string; isAdmin?: boolean }
  | { kind: "owner"; id: string; email: string }
  | { kind: "anon" };

export const OWNER_COOKIE = "tammy_owner";
export const HR_COOKIE = "tammy_hr";
export const HR_DISPLAY_COOKIE = "tammy_hr_display";

const EMAIL_CHANGE_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_EMAIL_LEN = 320;

type SessionPayload = {
  v?: unknown;
  kind?: unknown;
  id?: unknown;
  name?: unknown;
  email?: unknown;
  exp?: unknown;
};

export function getSessionSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") return null;
  return "dev-only-insecure-session-secret";
}

function b64urlEncode(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

function b64urlDecode(part: string): string | null {
  try {
    return Buffer.from(part, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function tryDecode(v: string): string | null {
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
}

export function signaturesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length || ab.length === 0) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN || !email.includes("@")) return null;
  return email;
}

function issueNonce(
  purpose: string,
  id: string,
  email: string,
  ttlMs: number,
): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const clean = normalizeEmail(email);
  if (!clean || typeof id !== "string" || !id) return null;
  const exp = Date.now() + ttlMs;
  const body = b64urlEncode(
    JSON.stringify({ v: 1, purpose, id, email: clean, exp }),
  );
  const sig = createHmac("sha256", secret).update(`${purpose}.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

function verifyNonce(
  token: string | undefined | null,
  purpose: string,
  id: string,
  email: string,
): boolean {
  if (!token || typeof token !== "string") return false;
  if (!getSessionSecret()) return false;
  const clean = normalizeEmail(email);
  if (!clean || !id) return false;
  const variants = [token];
  const dec = tryDecode(token);
  if (dec && dec !== token) variants.push(dec);
  for (const candidate of variants) {
    const dot = candidate.lastIndexOf(".");
    if (dot <= 0) continue;
    const body = candidate.slice(0, dot);
    const sig = candidate.slice(dot + 1);
    if (!body || !sig) continue;
    const secret = getSessionSecret();
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(`${purpose}.${body}`).digest("base64url");
    if (!signaturesEqual(sig, expected)) continue;
    const json = b64urlDecode(body);
    if (!json) continue;
    let obj: SessionPayload & { purpose?: unknown };
    try {
      obj = JSON.parse(json) as SessionPayload & { purpose?: unknown };
    } catch {
      continue;
    }
    if (obj.purpose !== purpose) continue;
    if (obj.id !== id) continue;
    if (normalizeEmail(obj.email) !== clean) continue;
    if (typeof obj.exp !== "number" || !Number.isFinite(obj.exp) || Date.now() > obj.exp) {
      continue;
    }
    return true;
  }
  return false;
}

export function issueEmailChangeToken(
  candidateId: string,
  newEmail: string,
): string | null {
  return issueNonce("email-change", candidateId, newEmail, EMAIL_CHANGE_TOKEN_TTL_MS);
}

export function verifyEmailChangeToken(
  token: string | undefined | null,
  candidateId: string,
  newEmail: string,
): boolean {
  return verifyNonce(token, "email-change", candidateId, newEmail);
}

const EMAIL_OWNERSHIP_TTL_MS = 30 * 60 * 1000;

/**
 * Proof that the mailbox owner confirmed an address. Issued only by the
 * verification endpoint after the emailed link is opened — never returned to
 * the caller who requested verification.
 */
export function issueEmailOwnershipToken(email: string): string | null {
  return issueNonce("email-ownership", "own", email, EMAIL_OWNERSHIP_TTL_MS);
}

export function verifyEmailOwnershipToken(token: string | undefined | null, email: string): boolean {
  return verifyNonce(token, "email-ownership", "own", email);
}

export function clearSessionCookie(name: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly;${secure}`;
}

const CONTACT_CHANNELS = [
  ["show_email", "contact_email"],
  ["show_phone", "contact_phone"],
  ["show_linkedin", "linkedin_url"],
  ["show_github", "github_url"],
  ["show_resume", "resume_url"],
  ["show_portfolio", "portfolio_url"],
  ["show_photo", "photo_url"],
] as const;

export function stripCandidatePii<T extends Record<string, unknown>>(
  candidate: T | null | undefined,
): T | null {
  if (!candidate) return candidate ?? null;
  const out: Record<string, unknown> = { ...candidate };
  for (const [flag, column] of CONTACT_CHANNELS) {
    if (out[flag] !== true) {
      out[column] = null;
    }
  }
  return out as T;
}

export function bundleForViewer(
  viewer: Viewer,
  candidate: Record<string, unknown> | null,
  bundle: {
    profile: unknown;
    contact_log: unknown[];
    matches: unknown[];
    shortlists: unknown[];
    projects: unknown[];
    oss: unknown[];
    experiences: unknown[];
    education: unknown[];
    skills: unknown[];
    depths: Record<string, Record<string, unknown>>;
  },
): Record<string, unknown> {
  const stripped = stripCandidatePii(candidate);
  const privileged = viewer.kind !== "anon";
  return {
    candidate: stripped,
    profile: bundle.profile ?? null,
    contact_log: privileged ? bundle.contact_log : [],
    matches: privileged ? bundle.matches : [],
    shortlists: privileged ? bundle.shortlists : [],
    projects: bundle.projects,
    oss: bundle.oss,
    experiences: bundle.experiences,
    education: bundle.education,
    skills: bundle.skills,
    depths: bundle.depths,
  };
}

export async function getViewerAuth(): Promise<Viewer> {
  try {
    const session = await getSessionUser();
    if (!session) return { kind: "anon" };
    return session.viewer;
  } catch {
    return { kind: "anon" };
  }
}

export async function guardOwnerAuth(
  _request: Request,
  candidateId: string,
): Promise<Response | null> {
  const session = await getSessionUser();
  const viewer = session?.viewer ?? { kind: "anon" as const };
  if (viewer.kind === "anon") {
    return Response.json({ error: "Sign in to manage this profile." }, { status: 401 });
  }
  const owned = await requireOwnerDb(candidateId, session);
  if (owned instanceof Response) return owned;
  return null;
}
