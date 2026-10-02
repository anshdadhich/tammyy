import { DurableObject } from "cloudflare:workers";
import { hashPassword, verifyPassword, type HasherOp, type HasherResult } from "@/lib/password";

const MAX_PASSWORD_BYTES = 800;

export class PasswordHasher extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    let op: HasherOp;
    try {
      op = (await request.json()) as HasherOp;
    } catch {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const password = typeof op.password === "string" ? op.password : "";
    if (!password || password.length > 200 || password.length > MAX_PASSWORD_BYTES) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    if (op.op === "hash") {
      const hash = await hashPassword(password);
      return Response.json({ hash } satisfies HasherResult);
    }
    if (op.op === "verify" && typeof op.stored === "string" && op.stored.length <= 512) {
      const valid = await verifyPassword(password, op.stored);
      return Response.json({ valid } satisfies HasherResult);
    }
    return Response.json({ error: "bad request" }, { status: 400 });
  }
}
