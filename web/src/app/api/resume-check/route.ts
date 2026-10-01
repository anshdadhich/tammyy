import { driveFileId } from "@/lib/drive";
import { getSessionUser } from "@/lib/auth-user";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 10 * 1024 * 1024;

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  if (h === "localhost") return false;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return false;
  if (/^127\./.test(h)) return false;
  if (/^10\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false;
  if (/^[0-9a-f:]+$/i.test(h) && h.includes(":")) return false;
  if (h === "google.com" || h.endsWith(".google.com")) return true;
  if (h === "googleusercontent.com" || h.endsWith(".googleusercontent.com")) return true;
  return false;
}

function urlSafe(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  return hostAllowed(u.hostname);
}

export async function GET(request: Request) {
  const rl = rateLimit(request, { key: "resume-check", limit: 30, windowMs: 10 * 60_000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const session = await getSessionUser();
  if (!session) {
    return Response.json({ status: "invalid", reason: "sign in required" }, { status: 401 });
  }
  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return Response.json({ status: "invalid", reason: "not a URL" }, { status: 400 });
  }
  const id = driveFileId(url);
  if (!id) {
    return Response.json(
      { status: "invalid", reason: "only Google Drive links can be checked" },
      { status: 400 },
    );
  }
  try {
    let current = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    let finalUrl = current;
    let contentType = "";
    let status = 0;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return Response.json({ status: "invalid", reason: "unsafe redirect target" }, { status: 400 });
      }
      if (!urlSafe(parsed)) {
        return Response.json({ status: "invalid", reason: "redirect target not allowed" }, { status: 400 });
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let head: Response | null = null;
      try {
        head = await fetch(current, {
          method: "HEAD",
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ReverseHiring-check/1.0)" },
        });
      } catch {
        head = null;
      } finally {
        clearTimeout(timer);
      }
      if (head) {
        const len = head.headers.get("content-length");
        if (len !== null && Number.isFinite(Number(len)) && Number(len) > MAX_BYTES) {
          return Response.json({ status: "unknown", reason: "file too large to check" });
        }
        const loc = head.headers.get("location");
        if (head.status >= 300 && head.status < 400 && loc) {
          current = new URL(loc, current).toString();
          finalUrl = current;
          try { await head.arrayBuffer(); } catch { }
          continue;
        }
        contentType = head.headers.get("content-type") ?? "";
        status = head.status;
        try { await head.arrayBuffer(); } catch { }
        finalUrl = current;
        break;
      }
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), 10000);
      try {
        const r = await fetch(current, {
          redirect: "manual",
          signal: ctrl2.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ReverseHiring-check/1.0)", Range: "bytes=0-0" },
        });
        const loc = r.headers.get("location");
        if (r.status >= 300 && r.status < 400 && loc) {
          current = new URL(loc, current).toString();
          finalUrl = current;
          try { await r.arrayBuffer(); } catch { }
          continue;
        }
        contentType = r.headers.get("content-type") ?? "";
        status = r.status;
        finalUrl = r.url || current;
        try { await r.arrayBuffer(); } catch { }
        break;
      } catch {
        return Response.json({ status: "unknown", reason: "check failed, try again" });
      } finally {
        clearTimeout(timer2);
      }
    }
    if (/accounts\.google\.com|ServiceLogin/i.test(finalUrl)) {
      return Response.json({ status: "restricted", reason: "Google asks to log in - sharing is off" });
    }
    if (status === 403 || status === 404) {
      return Response.json({ status: "restricted", reason: `Google returned ${status}` });
    }
    if (contentType.includes("text/html")) {
      return Response.json({ status: "reachable", note: "shared - large files may show one confirm screen" });
    }
    if (status !== 0 && (status < 200 || status >= 300)) {
      return Response.json({ status: "unknown", http: status });
    }
    return Response.json({ status: "reachable" });
  } catch {
    return Response.json({ status: "unknown", reason: "check failed, try again" });
  }
}
