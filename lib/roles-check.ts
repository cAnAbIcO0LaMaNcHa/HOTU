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

/**
 * Quién entra al panel de moderación (tanda 5 §4).
 *
 * ============================================================
 * MODERAR NO ES ADMINISTRAR
 * ============================================================
 *
 * Desde que el admin dejó de ser un CMS y pasó a ser solo moderación, la
 * única forma de darle a alguien acceso al panel era hacerlo
 * SUPER_ADMIN: o sea, para que pudiera aprobar una noticia había que
 * darle también los roles, la plata de los pedidos y el poder de
 * nombrarse a sí mismo. Un permiso que solo viene en talle único se
 * termina repartiendo de más.
 *
 * MODERATOR abre las dos colas, la censura y el ban, y nada más. ROLES y
 * PEDIDOS siguen pidiendo SUPER_ADMIN por su cuenta: nombrar moderadores
 * y emitir tiquetes no son moderación.
 *
 * Un SUPER_ADMIN es moderador por definición, así que no hace falta
 * darle las dos filas.
 *
 * Vive acá y no en lib/roles.ts por lo mismo que isSuperAdmin: este
 * archivo no importa @/auth, y el middleware de Edge no puede bundlear
 * el provider de credenciales. Y el middleware y el layout tienen que
 * correr LA MISMA función, si no alguien pasa una puerta y rebota en la
 * otra.
 */
export async function isModerator(email?: string | null): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const rows = await sql`
    SELECT 1 FROM user_roles
    WHERE email = ${email} AND role IN ('SUPER_ADMIN', 'MODERATOR')
  `;
  return rows.length > 0;
}

