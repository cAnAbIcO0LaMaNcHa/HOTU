/**
 * ONE-TIME SETUP ENDPOINT — TANDA 2, PARTE A: the columns the EPK's
 * TRACKS and DJ SETS sections were sketched with but never had, plus the
 * foreign keys those two tables never declared.
 *
 * Protected by MIGRATE_SECRET. Call it as:
 *   /api/setup-epk-content?secret=YOUR_SECRET
 * Safe to re-run: every statement is idempotent.
 *
 * A separate route from setup-profiles on purpose. setup-profiles is the
 * tanda 1 profile schema and has already run on main; folding unrelated
 * tanda 2 columns into it would mean re-running all of that on main for
 * changes that have nothing to do with it, and would blur which migration
 * introduced what.
 *
 * Purely additive: no column is dropped or rewritten, and every new one is
 * nullable, so existing rows are untouched.
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

  /** Postgres has no ADD CONSTRAINT IF NOT EXISTS — same helper as
   *  setup-profiles, so a second run is a no-op instead of an error. */
  const ensureConstraint = async (label: string, alterStatement: string) => {
    await sql(
      `DO $$ BEGIN ${alterStatement}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    );
    log.push(label);
  };

  try {
    // ---------------------------------------------------------------
    // tracks — the EPK squares: cover art, label, manual ordering.
    // ---------------------------------------------------------------
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS cover_url TEXT`;
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS label TEXT`;

    // NULL means "no manual position". Readers order by sort_order with
    // NULLS LAST and fall back to the release date, so an artist who never
    // reorders anything still gets a sensible newest-first list.
    await sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS sort_order INTEGER`;
    log.push("tracks columns ready (cover_url, label, sort_order)");

    // ---------------------------------------------------------------
    // dj_sets — same, minus the label: a recorded set has no imprint.
    // ---------------------------------------------------------------
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS cover_url TEXT`;
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS sort_order INTEGER`;
    log.push("dj_sets columns ready (cover_url, sort_order)");

    // ---------------------------------------------------------------
    // The foreign keys both tables were created without.
    //
    // ON UPDATE CASCADE is mandatory against a text primary key: renaming
    // an artist's slug without it would strand every one of their rows.
    //
    // ON DELETE SET NULL, not CASCADE. artist_slug is nullable and
    // artist_name is not, so a row survives the loss of its link and still
    // renders in /sets and /discografia under the artist's name. Deleting
    // an artist should not silently erase their discography from the
    // public site; unlinking it is recoverable, deleting it is not.
    // ---------------------------------------------------------------
    await ensureConstraint(
      "dj_sets.artist_slug fk ready",
      `ALTER TABLE dj_sets
         ADD CONSTRAINT dj_sets_artist_slug_fkey
         FOREIGN KEY (artist_slug) REFERENCES artists(slug)
         ON UPDATE CASCADE ON DELETE SET NULL`
    );

    await ensureConstraint(
      "tracks.artist_slug fk ready",
      `ALTER TABLE tracks
         ADD CONSTRAINT tracks_artist_slug_fkey
         FOREIGN KEY (artist_slug) REFERENCES artists(slug)
         ON UPDATE CASCADE ON DELETE SET NULL`
    );

    // The EPK reads both tables filtered by artist on every profile view.
    await sql`CREATE INDEX IF NOT EXISTS dj_sets_artist_slug_idx ON dj_sets (artist_slug)`;
    await sql`CREATE INDEX IF NOT EXISTS tracks_artist_slug_idx ON tracks (artist_slug)`;
    log.push("artist_slug indexes ready");

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM tracks)  AS tracks,
        (SELECT COUNT(*)::int FROM dj_sets) AS dj_sets,
        (SELECT COUNT(*)::int FROM tracks  WHERE artist_slug IS NULL) AS tracks_sin_artista,
        (SELECT COUNT(*)::int FROM dj_sets WHERE artist_slug IS NULL) AS sets_sin_artista
    `;

    return NextResponse.json({ ok: true, log, counts });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
