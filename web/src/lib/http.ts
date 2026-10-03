function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response; status: number }> {
  // Defense-in-depth: SameSite=Lax blocks cross-site sends already; an
  // explicit Origin check survives any future cookie change.
  if (crossOrigin(request)) {
    return {
      ok: false,
      response: Response.json({ error: "cross-origin request rejected" }, { status: 403 }),
      status: 403,
    };
  }
  const ct = request.headers.get("content-type") ?? "";
  if (ct && !ct.toLowerCase().includes("application/json")) {
    return { ok: false, response: Response.json({ error: "content-type must be application/json" }, { status: 415 }), status: 415 };
  }
  const lenRaw = request.headers.get("content-length");
  if (lenRaw !== null) {
    const n = Number(lenRaw);
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, response: Response.json({ error: "request body too large" }, { status: 413 }), status: 413 };
    }
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: Response.json({ error: "could not read request body" }, { status: 400 }), status: 400 };
  }
  if (text.length === 0) return { ok: true, body: null };
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return { ok: false, response: Response.json({ error: "request body too large" }, { status: 413 }), status: 413 };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: Response.json({ error: "invalid JSON body" }, { status: 400 }), status: 400 };
  }
}
