import { getSessionUser } from "./auth-user";

export type Role = "candidate" | "employer" | "admin";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export async function requireRole(
  role: Role | Role[],
): Promise<{ authId: string; email: string; userId: string }> {
  const session = await getSessionUser();
  const row = session?.userRow ?? null;
  if (!session || !row) {
    throw new AuthError("Unauthorized - sign in first", 401);
  }
  if (row.status !== "active") {
    throw new AuthError("Account suspended", 403);
  }
  const roles = Array.isArray(role) ? role : [role];
  if (!roles.includes(row.role as Role)) {
    throw new AuthError(
      `Forbidden - requires role: ${roles.join(" or ")}`,
      403,
    );
  }
  return { authId: session.authId, email: session.email, userId: row.id };
}
