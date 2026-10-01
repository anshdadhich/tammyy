import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { z } from "zod";
import { readJsonBody } from "@/lib/http";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/password";
import { AppDoc, col, Collections } from "@/lib/mongo";
import { createSession, setSessionCookie } from "@/lib/session";
import { ensureAuthIndexes } from "@/lib/auth-user";
import { normalizeEmail } from "@/lib/validators";

/**
 * POST /api/auth/claim — set (or confirm) the password on a candidate
 * identity and open a session. Called by the join wizard at publish time.
 *
 * - no user row yet → create one with role "candidate"
 * - passwordless row → set the password (first claim wins)
 * - password already set → it must match (401 "Incorrect password.")
 * - suspended row → 403
 * - then link any orphan candidate row (contact_email, user_id:null)
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000;
}

/** Set-or-verify the password on an existing row. */
async function claimRow(
  users: Collection<AppDoc>,
  raw: AppDoc,
  password: string,
): Promise<"ok" | "bad-password" | "suspended"> {
  const stored =
    typeof raw.password_hash === "string" && raw.password_hash ? raw.password_hash : null;
  if (stored) {
    if (!(await verifyPassword(password, stored))) return "bad-password";
  } else {
    const password_hash = await hashPassword(password);
    await users.updateOne({ _id: raw._id }, { $set: { password_hash } });
  }
  if (typeof raw.status === "string" && raw.status !== "active") return "suspended";
  return "ok";
}

export async function POST(request: Request): Promise<Response> {
  const ipLimit = rateLimit(request, {
    key: "auth-claim",
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit.retryAfterMs);

  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  const policy = passwordPolicyError(parsed.data.password);
  if (policy) return Response.json({ error: policy }, { status: 400 });

  const email = normalizeEmail(parsed.data.email);
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const emailLimit = rateLimit(request, {
    key: "auth-claim-email",
    limit: 10,
    windowMs: 10 * 60_000,
    principal: email,
  });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit.retryAfterMs);

  await ensureAuthIndexes();

  const users = await col<AppDoc>(Collections.users);
  try {
    let raw = await users.findOne({ email });
    let userId: string;

    if (raw) {
      const outcome = await claimRow(users, raw, parsed.data.password);
      if (outcome === "bad-password") {
        return Response.json({ error: "Incorrect password." }, { status: 401 });
      }
      if (outcome === "suspended") {
        return Response.json({ error: "Account suspended." }, { status: 403 });
      }
      userId = raw._id;
    } else {
      // First claim for an email the wizard already created a page for.
      userId = randomUUID();
      const password_hash = await hashPassword(parsed.data.password);
      try {
        await users.insertOne({
          _id: userId,
          email,
          password_hash,
          role: "candidate",
          status: "active",
          email_verified: false,
          created_at: new Date(),
        });
      } catch (e) {
        if (!isDuplicateKey(e)) throw e;
        // Lost a race with a concurrent claim — verify against theirs.
        raw = await users.findOne({ email });
        if (!raw) throw e;
        const outcome = await claimRow(users, raw, parsed.data.password);
        if (outcome === "bad-password") {
          return Response.json({ error: "Incorrect password." }, { status: 401 });
        }
        if (outcome === "suspended") {
          return Response.json({ error: "Account suspended." }, { status: 403 });
        }
        userId = raw._id;
      }
    }

    // Link any orphan candidate row published under this email.
    const candidates = await col<AppDoc>(Collections.candidates);
    await candidates.updateMany(
      { contact_email: email, user_id: null },
      { $set: { user_id: userId } },
    );

    const { token, expires } = await createSession(userId, {
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    });
    await setSessionCookie(token, expires);
    return Response.json({ ok: true, email });
  } catch (e) {
    console.error("[auth/claim] failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not set your password. Try again." }, { status: 503 });
  }
}
