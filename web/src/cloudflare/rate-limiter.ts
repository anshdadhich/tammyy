import { DurableObject } from "cloudflare:workers";

type Bucket = { count: number; resetAt: number };
type ConsumeOp = { key: string; limit: number; windowMs: number };

const PRUNE_EVERY = 500;

/**
 * Per-key fixed-window counters in one Durable Object so limits hold across
 * isolates. State is kept in memory and mirrored to DO storage so restarts
 * don't hand out a fresh allowance for an active window.
 */
export class RateLimiter extends DurableObject<CloudflareEnv> {
  private buckets: Map<string, Bucket> | null = null;

  private async load(): Promise<Map<string, Bucket>> {
    if (!this.buckets) {
      const buckets = new Map<string, Bucket>();
      const entries = await this.ctx.storage.kv.list({ prefix: "rl:" });
      const now = Date.now();
      for (const [k, v] of entries) {
        const b = v as unknown as Bucket;
        if (b?.resetAt && now >= b.resetAt) {
          await this.ctx.storage.kv.delete(k);
          continue;
        }
        buckets.set(k.slice(3), b);
      }
      this.buckets = buckets;
    }
    return this.buckets;
  }

  private async prune(buckets: Map<string, Bucket>): Promise<void> {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) {
        buckets.delete(k);
        await this.ctx.storage.kv.delete(`rl:${k}`);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    let op: ConsumeOp;
    try {
      op = (await request.json()) as ConsumeOp;
    } catch {
      return Response.json({ ok: false, remaining: 0, retryAfterMs: 30_000 });
    }
    if (
      typeof op?.key !== "string" || op.key.length < 1 || op.key.length > 200 ||
      typeof op?.limit !== "number" || !Number.isFinite(op.limit) || op.limit < 1 || op.limit > 100_000 ||
      typeof op?.windowMs !== "number" || !Number.isFinite(op.windowMs) || op.windowMs < 1_000 || op.windowMs > 24 * 60 * 60_000
    ) {
      return Response.json({ ok: false, remaining: 0, retryAfterMs: 30_000 });
    }
    const now = Date.now();
    const buckets = await this.load();
    const cur = buckets.get(op.key);
    if (!cur || now >= cur.resetAt) {
      const fresh: Bucket = { count: 1, resetAt: now + op.windowMs };
      buckets.set(op.key, fresh);
      await this.ctx.storage.kv.put(`rl:${op.key}`, fresh);
      if (buckets.size % PRUNE_EVERY === 0) await this.prune(buckets);
      return Response.json({ ok: true, remaining: op.limit - 1, retryAfterMs: 0 });
    }
    if (cur.count >= op.limit) {
      return Response.json({ ok: false, remaining: 0, retryAfterMs: cur.resetAt - now });
    }
    cur.count += 1;
    await this.ctx.storage.kv.put(`rl:${op.key}`, cur);
    return Response.json({ ok: true, remaining: op.limit - cur.count, retryAfterMs: 0 });
  }
}
