/**
 * ONE-TIME SETUP ENDPOINT — adds the global/country content columns (scope,
 * country_code, language, status, featured, priority_at) to every content
 * table, plus a `countries` table seeded with COL. All ALTER TABLE ADD
 * COLUMN statements use safe defaults that exactly replicate today's
 * behaviour (everything is Colombian, Spanish, published) so no existing
 * row's visible behaviour changes. Protected by MIGRATE_SECRET. Call it as:
 * /api/setup-content?secret=YOUR_SECRET — safe to re-run.
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
      CREATE TABLE IF NOT EXISTS countries (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_language TEXT NOT NULL,
        currency TEXT NOT NULL,
        timezone TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true
      )
    `;
    await sql`
      INSERT INTO countries (code, name, default_language, currency, timezone)
      VALUES ('COL', 'Colombia', 'es', 'COP', 'America/Bogota')
      ON CONFLICT (code) DO NOTHING
    `;
    log.push("table countries ready, COL seeded");

    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'country'`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'COL'`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es'`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ`;
    log.push("table artists: content columns ready");

    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'country'`;
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'COL'`;
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es'`;
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`;
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ`;
    log.push("table tracks: content columns ready");

    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'country'`;
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'COL'`;
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es'`;
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`;
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ`;
    log.push("table dj_sets: content columns ready");

    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'country'`;
    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'COL'`;
    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es'`;
    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`;
    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ`;
    log.push("table collectives: content columns ready");

    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'country'`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'COL'`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es'`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ`;
    log.push("table events: content columns ready");

    await sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'country'`;
    await sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'COL'`;
    await sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es'`;
    await sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`;
    await sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ`;
    log.push("table news: content columns ready");

    return NextResponse.json({ ok: true, log });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
