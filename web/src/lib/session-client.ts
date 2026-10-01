export type ViewerSession = { kind: "hr" | "owner"; name?: string; email: string; isAdmin?: boolean };

export const SESSION_EVENT = "tammy-session-changed";

const REMEMBER_KEY = "tammy_viewer";
const REMEMBER_TTL_MS = 10 * 60_000;

type RememberedViewer = ViewerSession & { ts: number };

/**
 * Optimistic last-known viewer so the nav can paint an avatar instantly on
 * repeat visits. NEVER authoritative: the server response from
 * fetchViewer() always wins. Cleared on sign-out.
 */
export function rememberViewer(v: ViewerSession | null): void {
  if (typeof document === "undefined") return;
  try {
    if (!v) {
      localStorage.removeItem(REMEMBER_KEY);
      return;
    }
    const rec: RememberedViewer = { ...v, ts: Date.now() };
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(rec));
  } catch {
  }
}

export function recallViewer(): ViewerSession | null {
  if (typeof document === "undefined") return null;
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as Partial<RememberedViewer>;
    if (!rec || typeof rec.email !== "string" || !rec.email.includes("@")) return null;
    if (rec.kind !== "hr" && rec.kind !== "owner") return null;
    if (typeof rec.ts !== "number" || Date.now() - rec.ts > REMEMBER_TTL_MS) {
      localStorage.removeItem(REMEMBER_KEY);
      return null;
    }
    return {
      kind: rec.kind,
      name: typeof rec.name === "string" && rec.name.trim() ? rec.name : undefined,
      email: rec.email,
      isAdmin: rec.isAdmin === true,
    };
  } catch {
    return null;
  }
}

function notifySessionChanged() {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

type MeResponse = {
  authenticated?: unknown;
  viewer?: {
    kind?: unknown;
    name?: unknown;
    email?: unknown;
    isAdmin?: unknown;
  } | null;
};

function parseViewer(data: MeResponse | null): ViewerSession | null {
  const v = data?.viewer;
  if (!v || typeof v !== "object") return null;
  if (typeof v.email !== "string" || !v.email.includes("@")) return null;
  if (v.kind !== "hr" && v.kind !== "owner") return null;
  return {
    kind: v.kind,
    name: typeof v.name === "string" && v.name.trim() ? v.name : undefined,
    email: v.email,
    isAdmin: v.isAdmin === true,
  };
}

/**
 * Authoritative session read: GET /api/auth/me reads the httpOnly
 * `tammy_session` cookie server-side. Returns null when signed out.
 * Network/5xx failures throw (callers keep their optimistic state)
 * rather than being mistaken for "signed out".
 */
export async function fetchViewer(): Promise<ViewerSession | null> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`session check failed: ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as MeResponse | null;
  const viewer = parseViewer(data);
  if (viewer) rememberViewer(viewer);
  else rememberViewer(null);
  return viewer;
}

/** Best-effort viewer read: failures resolve to null without clobbering UI. */
export async function fetchViewerSafe(): Promise<ViewerSession | null> {
  try {
    return await fetchViewer();
  } catch {
    return null;
  }
}

/**
 * Sign out: revoke the server session, clear optimistic state, notify
 * listeners. Always resolves.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
  }
  rememberViewer(null);
  notifySessionChanged();
}

/** @deprecated Use signOut(). Kept for existing call sites. */
export const clearHrSession = signOut;
/** @deprecated Use signOut(). Kept for existing call sites. */
export const clearOwnerSession = signOut;

export function viewerInitials(viewer: ViewerSession): string {
  if (viewer.name) {
    const words = viewer.name.trim().split(/\s+/).filter(Boolean);
    const first = words[0]?.[0] ?? "";
    const second = words.length > 1 ? (words[1][0] ?? "") : (words[0]?.[1] ?? "");
    return (first + second).toUpperCase() || "?";
  }
  const local = viewer.email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}
