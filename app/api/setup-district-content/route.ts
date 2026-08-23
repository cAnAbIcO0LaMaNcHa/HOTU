/**
 * ONE-TIME SETUP ENDPOINT — adds the `district` column to `news` and
 * `collectives`, the two content tables that didn't have it yet (events,
 * artists, tracks, and dj_sets already carry it). Defaults every existing
 * row to D00 so nothing changes visibly until an admin re-classifies it.
 * Protected by MIGRATE_SECRET. Call it as:
 * /api/setup-district-content?secret=YOUR_SECRET — safe to re-run.
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
    await sql`ALTER TABLE news ADD COLUMN IF NOT EXISTS district TEXT NOT NULL DEFAULT 'D00'`;
    log.push("table news: district column ready");

    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS district TEXT NOT NULL DEFAULT 'D00'`;
    log.push("table collectives: district column ready");

    return NextResponse.json({ ok: true, log });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
