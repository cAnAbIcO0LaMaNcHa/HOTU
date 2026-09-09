/**
 * The one permission check that middleware.ts needs, kept free of any
 * import of @/auth so it stays Edge-bundlable. Everything in lib/roles.ts
 * that reads the current session lives there; this module only answers
 * questions about an email that the caller already has.
 *
 * lib/roles.ts re-exports isSuperAdmin, so /admin's layout and the
 * middleware still run literally the same function — the guarantee the
 * middleware comment depends on.
 */

import { neon } from "@neondatabase/serverless";
import { isAdminEmail } from "./admin-emails";

const sql = neon(process.env.DATABASE_URL!);

/**
 * A SUPER_ADMIN is anyone in the legacy ADMIN_EMAILS whitelist (kept for
 * backwards compatibility — nothing that already worked stops working) OR
 * anyone with an explicit SUPER_ADMIN row in user_roles.
 */
export async function isSuperAdmin(email?: string | null): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const rows = await sql`
    SELECT 1 FROM user_roles WHERE email = ${email} AND role = 'SUPER_ADMIN'
  `;
  return rows.length > 0;
}
