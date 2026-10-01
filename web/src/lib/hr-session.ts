import { getNavSession, getSessionUser, employerStatusOf } from "@/lib/auth-user";

export type ViewerSession = { kind: "hr" | "owner"; name?: string; email: string; isAdmin?: boolean };

export type HrSession = {
  email: string;
  name?: string;
  isAdmin?: boolean;
  employerStatus?: "verified" | "pending" | "none";
};

export async function readHrSession(): Promise<HrSession | null> {
  let session: Awaited<ReturnType<typeof getSessionUser>>;
  try {
    session = await getSessionUser();
  } catch {
    return null;
  }
  if (!session || session.viewer.kind !== "hr") return null;
  const out: HrSession = { email: session.viewer.email };
  if (session.viewer.name) out.name = session.viewer.name;
  out.isAdmin = session.viewer.isAdmin === true;
  out.employerStatus = employerStatusOf(session.employer);
  return out;
}

export async function readNavViewer(): Promise<ViewerSession | null> {
  let nav: Awaited<ReturnType<typeof getNavSession>>;
  try {
    nav = await getNavSession();
  } catch {
    return null;
  }
  if (!nav) return null;
  if (nav.role === "employer" || nav.role === "admin") {
    return { kind: "hr", email: nav.email, isAdmin: nav.role === "admin" };
  }
  if (nav.role === "candidate") return { kind: "owner", email: nav.email };
  return null;
}
