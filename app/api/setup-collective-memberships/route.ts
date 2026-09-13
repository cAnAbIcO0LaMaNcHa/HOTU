/**
 * DATA MIGRATION — TANDA 2, PARTE B: collectives.artist_slugs (jsonb) to
 * rows in artist_collectives.
 *
 * Protected by MIGRATE_SECRET. Call it as:
 *   /api/setup-collective-memberships?secret=YOUR_SECRET&dryRun=1   (report only)
 *   /api/setup-collective-memberships?secret=YOUR_SECRET            (apply)
 *
 * dryRun reads and reports without writing a single row, so the expected
 * counts can be checked against the real production data BEFORE anything
 * changes — the same code path that would do the work, not a separate
 * approximation of it.
 *
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";

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

      if (!dryRun) {
        await sql`
          INSERT INTO artist_collectives (artist_slug, collective_slug, kind, from_date, accepted_at)
          VALUES (${artistSlug}, ${collectiveSlug}, 'toca_con', CURRENT_DATE, now())
        `;
      }
      inserted++;
    }

    log.push(
      dryRun
        ? `SIMULACIÓN: se insertarían ${inserted}, ya existen ${already}, se saltearían ${skipped.length}`
        : `insertadas ${inserted}, ya existían ${already}, salteadas ${skipped.length}`
    );

    /**
     * Per-collective conservation check, computed here rather than trusted.
     *
     * This used to also project status_membership and warn about
     * collectives whose flag would flip. That is gone: tanda 3 (§1.1)
     * removed the publishable/incomplete state entirely, so there is no
     * flag left to recompute or to warn about. What remains is the part
     * that actually mattered — whether every slug in the jsonb ends up
     * with an active row.
     */
    const projection = await sql`
      SELECT c.slug,
             (SELECT COUNT(DISTINCT ac.artist_slug)::int FROM artist_collectives ac
               WHERE ac.collective_slug = c.slug AND ac.to_date IS NULL) AS djs_ahora,
             jsonb_array_length(c.artist_slugs)::int AS en_jsonb,
             (SELECT COUNT(DISTINCT y #>> '{}')::int FROM jsonb_array_elements(c.artist_slugs) y
               WHERE EXISTS (SELECT 1 FROM artists a WHERE a.slug = y #>> '{}')
                 AND NOT EXISTS (
                   SELECT 1 FROM artist_collectives ac
                   WHERE ac.collective_slug = c.slug AND ac.artist_slug = y #>> '{}' AND ac.to_date IS NULL
                 )) AS se_agregarian
      FROM collectives c ORDER BY c.slug
    `;

    const porColectivo = projection.map((r) => ({
      slug: r.slug,
      en_jsonb: Number(r.en_jsonb),
      djs_ahora: Number(r.djs_ahora),
      se_agregarian: Number(r.se_agregarian),
      djs_despues: Number(r.djs_ahora) + Number(r.se_agregarian),
    }));

    const sinMigrar = porColectivo.reduce((n, r) => n + r.se_agregarian, 0);

    return NextResponse.json({
      ok: true,
      dryRun,
      log,
      skipped,
      // After a real run this must be 0. In a dry run it is what WOULD be
      // inserted, so it should equal the "se insertarían" count above.
      sinMigrar,
      porColectivo,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, dryRun, error: err instanceof Error ? err.message : String(err), log, skipped },
      { status: 500 }
    );
  }
}
