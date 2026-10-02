import { z } from "zod";
import { issueEmailOwnershipToken } from "@/lib/api-auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validators";
import { sendEmail } from "@/lib/email";
import { readJsonBody } from "@/lib/http";

/**
 * POST /api/auth/verify-email — sends an ownership-confirmation link to the
 * mailbox. The link carries a signed token; possession of it (opened from
 * inside the mailbox) is the proof /api/auth/claim requires before a
 * passwordless identity can be claimed.
 */
const bodySchema = z.object({
  email: z.string().trim().email().max(320),
});

export async function POST(request: Request): Promise<Response> {
  const rl = await rateLimit(request, { key: "auth-verify-email", limit: 5, windowMs: 15 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.email);
  if (!email) return Response.json({ error: "Enter a valid email." }, { status: 400 });

  const emailLimit = await rateLimit(request, {
    key: "auth-verify-email-addr",
    limit: 5,
    windowMs: 15 * 60_000,
    principal: email,
  });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit.retryAfterMs);

  const token = issueEmailOwnershipToken(email);
  if (!token) return Response.json({ error: "Try again shortly." }, { status: 503 });

  const origin = siteOrigin();
  const verifyUrl = `${origin}/join?claim_token=${encodeURIComponent(token)}&claim_email=${encodeURIComponent(email)}`;
  await sendEmail(
    email,
    "Confirm your email on Tammy",
    `<p>Confirm this address to claim your Tammy page:</p><p><a href="${verifyUrl}">Confirm email</a></p><p>This link expires in 30 minutes. If you didn't request this, ignore it.</p>`,
  );
  // Same response regardless of delivery state — never reveals whether the
  // address has an account.
  return Response.json({ ok: true });
}

function siteOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  try {
    return new URL(raw).origin;
  } catch {
    return "https://tammy.tammy-app.workers.dev";
  }
}
