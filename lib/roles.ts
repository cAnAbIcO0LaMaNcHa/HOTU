import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import { isAdminEmail } from "./admin";

const sql = neon(process.env.DATABASE_URL!);

export type Role = "SUPER_ADMIN" | "GLOBAL_EDITOR" | "COUNTRY_EDITOR";

export const ROLES: Role[] = ["SUPER_ADMIN", "GLOBAL_EDITOR", "COUNTRY_EDITOR"];

/**
 * Countries HOTU currently operates in. This is a plain constant (not a DB
 * table yet) on purpose — the full `countries` table with currency/timezone
 * comes in a later phase. This list only feeds the role-assignment picker.
 */
export const COUNTRY_CODES = ["COL"] as const;

export type RoleAssignment = {
  email: string;
  role: Role;
  /** Empty string means "not applicable" (SUPER_ADMIN / GLOBAL_EDITOR). */
  countryCode: string;
};

/** All role rows for the signed-in user. Empty array if not signed in. */
export async function getMyRoleAssignments(): Promise<RoleAssignment[]> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return [];
  const rows = await sql`SELECT email, role, country_code FROM user_roles WHERE email = ${email}`;
  return rows.map((r) => ({ email: r.email, role: r.role as Role, countryCode: r.country_code }));
}

/** Every role row in the system — only meant to be called after an isSuperAdmin() check. */
export async function getAllRoleAssignments(): Promise<RoleAssignment[]> {
  const rows = await sql`SELECT email, role, country_code FROM user_roles ORDER BY email, role`;
  return rows.map((r) => ({ email: r.email, role: r.role as Role, countryCode: r.country_code }));
}

/**
 * A SUPER_ADMIN is anyone in the legacy ADMIN_EMAILS whitelist (kept for
 * backwards compatibility — nothing that already worked stops working) OR
 * anyone with an explicit SUPER_ADMIN row in user_roles.
 */
export async function isSuperAdmin(email?: string | null): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const rows = await sql`SELECT 1 FROM user_roles WHERE email = ${email} AND role = 'SUPER_ADMIN'`;
  return rows.length > 0;
}

/** Returns the session only if the signed-in user is a SUPER_ADMIN. */
export async function requireSuperAdmin() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !(await isSuperAdmin(email))) return null;
  return session;
}

/**
 * The permission check every content-writing Server Action should call
 * before touching the database, once content carries a scope.
 *   canEditContent("global")            -> needs SUPER_ADMIN or GLOBAL_EDITOR
 *   canEditContent("country", "COL")    -> needs SUPER_ADMIN or COUNTRY_EDITOR for "COL"
 */
export async function canEditContent(
  scope: "global" | "country",
  countryCode?: string
): Promise<{ ok: boolean; email: string | null }> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!email) return { ok: false, email };
  if (await isSuperAdmin(email)) return { ok: true, email };

  const roles = await getMyRoleAssignments();
  if (scope === "global") {
    return { ok: roles.some((r) => r.role === "GLOBAL_EDITOR"), email };
  }
  return {
    ok: roles.some((r) => r.role === "COUNTRY_EDITOR" && r.countryCode === (countryCode ?? "")),
    email,
  };
}
