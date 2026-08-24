/**
 * ONE-TIME SETUP ENDPOINT — adds `collective_slug` to `merch_items`, so
 * each product can optionally be tied to the collective that made it.
 * Nullable and unconstrained on purpose (no FK) — matches the loose
 * typing style used elsewhere in this schema. Safe to re-run.
 * Call it as: /api/setup-merch-collective?secret=YOUR_SECRET
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
    await sql`ALTER TABLE merch_items ADD COLUMN IF NOT EXISTS collective_slug TEXT`;
    log.push("table merch_items: collective_slug column ready");

    // Two example assignments so the new filter has something to show
    // right away — swap these out or add more via a direct DB update as
    // real collective-branded merch gets added.
    await sql`UPDATE merch_items SET collective_slug = 'hotu-residents' WHERE slug = 'camiseta-hotu' AND collective_slug IS NULL`;
    await sql`UPDATE merch_items SET collective_slug = 'subsuelo-djs' WHERE slug = 'saco-hotu' AND collective_slug IS NULL`;
    log.push("assigned 2 example merch items to collectives");

    return NextResponse.json({ ok: true, log });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
