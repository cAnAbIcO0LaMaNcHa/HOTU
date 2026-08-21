/**
 * ONE-TIME SETUP ENDPOINT — creates the `tickets` table: one row per
 * individual ticket a person owns (not per line item), each with its own
 * high-entropy secure code used for the QR at the door. Protected by
 * MIGRATE_SECRET. Call it as: /api/setup-tickets?secret=YOUR_SECRET
 * Safe to re-run.
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
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_code TEXT UNIQUE NOT NULL,
        order_id INTEGER NOT NULL,
        order_item_id INTEGER NOT NULL,
        user_email TEXT NOT NULL,
        event_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'valid',
        checked_in_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    log.push("table tickets ready");

    await sql`CREATE INDEX IF NOT EXISTS tickets_user_email_idx ON tickets (user_email)`;
    await sql`CREATE INDEX IF NOT EXISTS tickets_order_item_id_idx ON tickets (order_item_id)`;
    log.push("indexes ready");

    // Friendly sequential ticket number shown on the ticket (e.g. AA0001).
    // Kept separate from ticket_code on purpose — see lib/tickets-write.ts.
    await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS display_code TEXT`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS tickets_display_code_idx
      ON tickets (display_code) WHERE display_code IS NOT NULL
    `;
    log.push("display_code column + index ready");

    // Optional per-event flyer image — becomes the ticket's background once
    // set. No admin upload UI yet; this just reserves the column so the
    // ticket page can start reading it. Null falls back to the district
    // theme, same as today.
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS flyer_url TEXT`;
    log.push("events.flyer_url column ready");

    const counts = await sql`SELECT COUNT(*) AS n FROM tickets`;
    return NextResponse.json({ ok: true, log, counts: { tickets: counts[0].n } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
