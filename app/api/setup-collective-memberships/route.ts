/**
 * DATA MIGRATION — TANDA 2, PARTE B: collectives.artist_slugs (jsonb) to
 * rows in artist_collectives.
 *
 * Protected by MIGRATE_SECRET. Call it as:
 *   /api/setup-collective-memberships?secret=YOUR_SECRET
 * Safe to re-run: a link that already exists is skipped, not duplicated.
 *
 * Its own route rather than part of setup-epk-content. That one is
 * additive schema; this one MOVES DATA, which is a different risk profile
 * and deserves to be runnable — and reviewable — on its own.
 *
 * NOTHING IS DROPPED. collectives.artist_slugs is left exactly as it is,
 * so if the copy turns out wrong the original is still there to retry
 * from. Removing the column is a separate migration, later, once this has
 * been running for a while.
 *
 * Why every row lands as 'toca_con': the jsonb is a flat array of slugs
 * and carries no notion of residency. "Residente de" is the link that
 * counts money, so inventing one would contaminate sales attribution,
 * while an ally link that should have been a residency is only a missing
 * promotion. Residencies get set by hand afterwards, through
 * /api/collectives/[slug]/members.
 *
 * Why from_date is today: the jsonb has no dates either. Backdating to the
 * artist's joined_at would fabricate a history the data never had.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { recalcMembership } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];
  const skipped: string[] = [];

  try {
    const entries = await sql`
      SELECT c.slug AS collective_slug, x #>> '{}' AS artist_slug
      FROM collectives c, jsonb_array_elements(c.artist_slugs) x
      ORDER BY c.slug
    `;
    log.push(`${entries.length} entradas en collectives.artist_slugs`);

    let inserted = 0;
    let already = 0;

    for (const e of entries) {
      const artistSlug = e.artist_slug as string;
      const collectiveSlug = e.collective_slug as string;

      // A slug pointing at an artist that no longer exists is reported and
      // skipped rather than allowed to abort the whole migration — one bad
      // entry should not block the other ten.
      const artist = await sql`SELECT 1 FROM artists WHERE slug = ${artistSlug}`;
      if (artist.length === 0) {
        skipped.push(`${collectiveSlug} -> ${artistSlug} (no existe el artista)`);
        continue;
      }

      const existing = await sql`
        SELECT 1 FROM artist_collectives
        WHERE artist_slug = ${artistSlug} AND collective_slug = ${collectiveSlug}
          AND kind = 'toca_con' AND to_date IS NULL
      `;
      if (existing.length > 0) {
        already++;
        continue;
      }

      await sql`
        INSERT INTO artist_collectives (artist_slug, collective_slug, kind, from_date, accepted_at)
        VALUES (${artistSlug}, ${collectiveSlug}, 'toca_con', CURRENT_DATE, now())
      `;
      inserted++;
    }

    log.push(`insertadas ${inserted}, ya existían ${already}, salteadas ${skipped.length}`);

    // Membership changed, so the publishable flag has to be recomputed.
    // With every migrated link landing as 'toca_con' this leaves the real
    // collectives at 'incompleto', which is the honest answer until
    // somebody marks residencies.
    const collectives = await sql`SELECT slug FROM collectives ORDER BY slug`;
    const statuses: Record<string, string> = {};
    for (const c of collectives) {
      statuses[c.slug as string] = await recalcMembership(c.slug as string);
    }
    log.push("status_membership recalculado en todos los colectivos");

    // Conservation check, computed here rather than trusted: every slug in
    // the jsonb must have an active row, for every collective.
    const check = await sql`
      SELECT c.slug,
             jsonb_array_length(c.artist_slugs)::int AS en_jsonb,
             (SELECT COUNT(*)::int FROM artist_collectives ac
               WHERE ac.collective_slug = c.slug AND ac.to_date IS NULL) AS vinculos_activos,
             (SELECT COUNT(*)::int FROM jsonb_array_elements(c.artist_slugs) y
               WHERE NOT EXISTS (
                 SELECT 1 FROM artist_collectives ac
                 WHERE ac.collective_slug = c.slug AND ac.artist_slug = y #>> '{}' AND ac.to_date IS NULL
               )) AS sin_migrar
      FROM collectives c ORDER BY c.slug
    `;

    const missing = check.reduce((n, r) => n + Number(r.sin_migrar), 0);

    return NextResponse.json({
      ok: true,
      log,
      skipped,
      sinMigrar: missing,
      statusMembership: statuses,
      porColectivo: check,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log, skipped },
      { status: 500 }
    );
  }
}
