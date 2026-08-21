/**
 * ONE-TIME TEST ENDPOINT — updates the event tied to the first ticket in
 * the system with real title/venue/city/date/flyer data, for previewing
 * the flyer-background ticket design. Protected by MIGRATE_SECRET.
 * POST body: { title, venue, city, eventDate, flyerBase64 }
 * flyerBase64 is stored as a data: URI in events.flyer_url.
 * Safe to re-run; only touches the one test event.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const body = await request.json();
    const { title, venue, city, eventDate, flyerBase64 } = body as {
      title: string;
      venue: string;
      city: string;
      eventDate: string;
      flyerBase64: string;
    };

    const flyerUrl = `data:image/jpeg;base64,${flyerBase64}`;

    const rows = await sql`
      UPDATE events
      SET title = ${title}, venue = ${venue}, city = ${city},
          event_date = ${eventDate}, flyer_url = ${flyerUrl}
      WHERE id = (SELECT event_id FROM tickets ORDER BY id LIMIT 1)
      RETURNING id, title
    `;

    return NextResponse.json({ ok: true, updated: rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
