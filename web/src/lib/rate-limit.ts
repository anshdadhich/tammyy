import { cfEnv } from "@/lib/cf";

const IP_PATTERN = /^[A-Za-z0-9.:]{1,45}$/;

export function clientIp(request: Request): string {
  const h = request.headers;
  const xff = h.get("x-forwarded-for") ?? "";
  const hops = xff
    .split(",")
    .map((s) => s.trim().slice(0, 45))
    .filter((s) => s.length > 0);
  // First hop is the original client (proxies append to the right). Using the
  // last hop collapses every visitor into one shared bucket, so take the first
  // hop and treat per-IP limits as advisory; per-email principal caps remain
  // the real backstop.
  const clientHop = hops.length > 0 ? hops[0] : "";
  const direct = (h.get("x-real-ip") ?? "").trim().slice(0, 45);
  const candidate = clientHop || direct;
  if (candidate && IP_PATTERN.test(candidate)) return candidate;
  return "unknown";
}

export type RateOutcome = { ok: boolean; remaining: number; retryAfterMs: number };

/**
 * Counters live in the RateLimiter Durable Object so limits hold across
 * isolates. A lookup failure fails open: rate limiting protects the
 * service, and a broken counter must not take the app down with it.
 */
export async function rateLimit(
  request: Request,
  opts: { key: string; limit: number; windowMs: number; principal?: string },
): Promise<RateOutcome> {
  const subject = (opts.principal ?? "").trim().slice(0, 160) || clientIp(request);
  const key = `${opts.key}:${subject}`;
  try {
    const env = await cfEnv();
    const stub = env.RATE_LIMITER.getByName("limits");
    const res = await stub.fetch("https://do/", {
      method: "POST",
      body: JSON.stringify({ key, limit: opts.limit, windowMs: opts.windowMs }),
    });
    return (await res.json()) as RateOutcome;
  } catch {
    return { ok: true, remaining: opts.limit, retryAfterMs: 0 };
  }
}

export async function rateLimitRoute(
  request: Request,
  opts: { key: string; limit: number; windowMs: number; principal?: string },
): Promise<Response | null> {
  const global = await rateLimit(request, { key: "global", limit: 600, windowMs: 60_000 });
  if (!global.ok) return rateLimitResponse(global.retryAfterMs);
  const scoped = await rateLimit(request, opts);
  if (!scoped.ok) return rateLimitResponse(scoped.retryAfterMs);
  return null;
}

export function rateLimitResponse(retryAfterMs: number): Response {
  return Response.json(
    { error: "Too many requests. Slow down and try again." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}
