/**
 * ONE-TIME SETUP ENDPOINT — creates the user_roles table and seeds it with
 * whatever emails are currently in ADMIN_EMAILS as SUPER_ADMIN, so the new
 * role system and the legacy env-var whitelist stay in sync from day one.
 * Protected by MIGRATE_SECRET. Call it as: /api/setup-roles?secret=YOUR_SECRET
 * Safe to re-run: every statement is idempotent.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS user_roles (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        country_code TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (email, role, country_code)
      )
    `;
    log.push("table user_roles ready");

    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    for (const email of adminEmails) {
      await sql`
        INSERT INTO user_roles (email, role, country_code)
        VALUES (${email}, 'SUPER_ADMIN', '')
        ON CONFLICT (email, role, country_code) DO NOTHING
      `;
    }
    log.push(`seeded ${adminEmails.length} SUPER_ADMIN row(s) from ADMIN_EMAILS`);

    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM user_roles) AS user_roles,
        (SELECT COUNT(*) FROM user_roles WHERE role = 'SUPER_ADMIN') AS super_admins
    `;

    return NextResponse.json({ ok: true, log, counts: counts[0] });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
