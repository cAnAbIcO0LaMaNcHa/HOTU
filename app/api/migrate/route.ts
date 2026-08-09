/**
 * ONE-TIME MIGRATION ENDPOINT
 *
 * Loads the static data from /lib/*.ts into the Postgres database.
 * Protected by MIGRATE_SECRET — call it as:
 *   /api/migrate?secret=YOUR_SECRET
 *
 * Safe to re-run: every insert is guarded against duplicates.
 * DELETE THIS FILE once the migration has run successfully.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { ARTISTS } from "@/lib/artists";
import { TRACKS } from "@/lib/tracks";
import { SETS } from "@/lib/sets";
import { COLLECTIVES } from "@/lib/collectives";

export const dynamic = "force-dynamic";

const EVENTS = [
  { date: "2026-06-14", city: "BOGOTÁ", venue: "Bodega 38", title: "HOTU PRIME · NOCHE 01", lineup: "Nina Acid · Subsuelo DJs · HOTU Residents", district: "D07" },
  { date: "2026-06-22", city: "LA CALERA", venue: "Cerro Verde", title: "HOTU RITUAL OPEN AIR", lineup: "Páramo Club · Monte Negro · HOTU 138", district: "D04" },
  { date: "2026-07-05", city: "CHÍA", venue: "Finca Norte", title: "CHÍA UNDERGROUND VOL.12", lineup: "Chía Underground · HOTU Crew", district: "D01" },
];

const NEWS = [
  { tag: "RELEASE", date: "2026-05-02", title: "HOTU Records anuncia compilatorio de aniversario", excerpt: "12 tracks inéditos de productores residentes de Bogotá, Chía y La Calera." },
  { tag: "GEAR", date: "2026-04-29", title: "Llega a Bogotá el primer lote del Analog Rytm MKIII", excerpt: "La nueva drum machine aterriza en tiendas locales para los productores de la sabana." },
  { tag: "CLUB", date: "2026-04-27", title: "Subterráneo reabre con sistema Funktion-One", excerpt: "El club bogotano vuelve con un line-up de apertura HOTU de 24 horas continuas." },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  try {
    for (const a of ARTISTS) {
      await sql`
        INSERT INTO artists (slug, name, genre, district, city, photo, bio, joined_at, sets, top_tracks)
        VALUES (${a.slug}, ${a.name}, ${a.genre}, ${a.district}, ${a.city}, ${a.photo ?? null},
                ${a.bio}, ${a.joinedAt}, ${JSON.stringify(a.sets ?? [])}, ${JSON.stringify(a.topTracks ?? [])})
        ON CONFLICT (slug) DO NOTHING
      `;
    }
    log.push(`artists: ${ARTISTS.length} processed`);

    for (const t of TRACKS) {
      await sql`
        INSERT INTO tracks (slug, title, artist_name, artist_slug, district, released_at, url)
        VALUES (${t.slug}, ${t.title}, ${t.artistName}, ${t.artistSlug ?? null},
                ${t.district}, ${t.releasedAt}, ${t.url})
        ON CONFLICT (slug) DO NOTHING
      `;
    }
    log.push(`tracks: ${TRACKS.length} processed`);

    for (const s of SETS) {
      await sql`
        INSERT INTO dj_sets (slug, title, artist_name, artist_slug, district, duration, recorded_at, url)
        VALUES (${s.slug}, ${s.title}, ${s.artistName}, ${s.artistSlug ?? null},
                ${s.district}, ${s.duration}, ${s.recordedAt}, ${s.url})
        ON CONFLICT (slug) DO NOTHING
      `;
    }
    log.push(`dj_sets: ${SETS.length} processed`);

    for (const c of COLLECTIVES) {
      await sql`
        INSERT INTO collectives (slug, name, type, sector, bio, artist_slugs)
        VALUES (${c.slug}, ${c.name}, ${c.type}, ${c.sector}, ${c.bio}, ${JSON.stringify(c.artistSlugs ?? [])})
        ON CONFLICT (slug) DO NOTHING
      `;
    }
    log.push(`collectives: ${COLLECTIVES.length} processed`);

    for (const e of EVENTS) {
      const existing = await sql`SELECT 1 FROM events WHERE title = ${e.title} AND event_date = ${e.date}`;
      if (existing.length === 0) {
        await sql`
          INSERT INTO events (event_date, city, venue, title, lineup, district)
          VALUES (${e.date}, ${e.city}, ${e.venue}, ${e.title}, ${e.lineup}, ${e.district})
        `;
      }
    }
    log.push(`events: ${EVENTS.length} processed`);

    for (const n of NEWS) {
      const existing = await sql`SELECT 1 FROM news WHERE title = ${n.title}`;
      if (existing.length === 0) {
        await sql`
          INSERT INTO news (tag, news_date, title, excerpt)
          VALUES (${n.tag}, ${n.date}, ${n.title}, ${n.excerpt})
        `;
      }
    }
    log.push(`news: ${NEWS.length} processed`);

    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM artists) AS artists,
        (SELECT COUNT(*) FROM tracks) AS tracks,
        (SELECT COUNT(*) FROM dj_sets) AS dj_sets,
        (SELECT COUNT(*) FROM collectives) AS collectives,
        (SELECT COUNT(*) FROM events) AS events,
        (SELECT COUNT(*) FROM news) AS news
    `;

    return NextResponse.json({ ok: true, log, counts: counts[0] });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
