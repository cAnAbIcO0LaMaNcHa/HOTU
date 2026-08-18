"use server";

import { neon } from "@neondatabase/serverless";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin, ROLES, type Role } from "./roles";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Grants a role to an email. Only a SUPER_ADMIN can call this — role
 * management is the one action in the whole admin that can escalate
 * privileges, so it gets its own, stricter gate instead of reusing the
 * general admin check.
 */
export async function addRole(formData: FormData): Promise<void> {
  if (!(await requireSuperAdmin())) return;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  const countryCodeRaw = String(formData.get("countryCode") ?? "").trim().toUpperCase();

  if (!email || !ROLES.includes(role as Role)) return;

  // Country code only makes sense (and is only stored) for COUNTRY_EDITOR.
  const countryCode = role === "COUNTRY_EDITOR" ? countryCodeRaw : "";
  if (role === "COUNTRY_EDITOR" && !countryCode) return;

  await sql`
    INSERT INTO user_roles (email, role, country_code)
    VALUES (${email}, ${role}, ${countryCode})
    ON CONFLICT (email, role, country_code) DO NOTHING
  `;

  revalidatePath("/admin/roles");
}

export async function removeRole(formData: FormData): Promise<void> {
  if (!(await requireSuperAdmin())) return;

  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "");
  const countryCode = String(formData.get("countryCode") ?? "");

  await sql`DELETE FROM user_roles WHERE email = ${email} AND role = ${role} AND country_code = ${countryCode}`;

  revalidatePath("/admin/roles");
}
