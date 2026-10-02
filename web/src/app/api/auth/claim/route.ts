import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { readJsonBody } from "@/lib/http";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { hashPasswordRemote, passwordPolicyError, verifyPasswordRemote } from "@/lib/password";
import { createSession, setSessionCookie } from "@/lib/session";
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

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const msg = String((e as { message?: string }).message ?? "");
  return /UNIQUE constraint failed/i.test(msg);
}

type ClaimOutcome = "ok" | "bad-password" | "suspended";

/** Set-or-verify the password on an existing row. */
async function claimRow(
  raw: typeof schema.users.$inferSelect,
  password: string,
): Promise<ClaimOutcome> {
  if (raw.password_hash) {
    if (!(await verifyPasswordRemote(password, raw.password_hash))) return "bad-password";
  } else {
    const password_hash = await hashPasswordRemote(password);
    const db = await getDb();
    await db.update(schema.users).set({ password_hash }).where(eq(schema.users.id, raw.id));
  }
  if (raw.status !== "active") return "suspended";
  return "ok";
}

export async function POST(request: Request): Promise<Response> {
  const ipLimit = await rateLimit(request, {
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

  const emailLimit = await rateLimit(request, {
    key: "auth-claim-email",
    limit: 10,
    windowMs: 10 * 60_000,
    principal: email,
  });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit.retryAfterMs);

  const db = await getDb();
  try {
    const existingRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    let raw = existingRows[0];
    let userId: string;

    if (raw) {
      const outcome = await claimRow(raw, parsed.data.password);
      if (outcome === "bad-password") {
        return Response.json({ error: "Incorrect password." }, { status: 401 });
      }
      if (outcome === "suspended") {
        return Response.json({ error: "Account suspended." }, { status: 403 });
      }
      userId = raw.id;
    } else {
      // First claim for an email the wizard already created a page for.
      userId = randomUUID();
      const password_hash = await hashPasswordRemote(parsed.data.password);
      try {
        await db.insert(schema.users).values({
          id: userId,
          email,
          password_hash,
          role: "candidate",
          status: "active",
          email_verified: false,
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // Lost a race with a concurrent claim — verify against theirs.
        const raced = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);
        raw = raced[0];
        if (!raw) throw e;
        const outcome = await claimRow(raw, parsed.data.password);
        if (outcome === "bad-password") {
          return Response.json({ error: "Incorrect password." }, { status: 401 });
        }
        if (outcome === "suspended") {
          return Response.json({ error: "Account suspended." }, { status: 403 });
        }
        userId = raw.id;
      }
    }

    // Link any orphan candidate row published under this email.
    await db
      .update(schema.candidates)
      .set({ user_id: userId })
      .where(and(eq(schema.candidates.contact_email, email), isNull(schema.candidates.user_id)));

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
