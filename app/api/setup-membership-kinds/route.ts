/**
 * DATA MIGRATION — TANDA 3, PIEZA 2: rename artist_collectives.kind.
 *
 *   'residente' -> 'casa'       the DJ's main collective. ONE only.
 *   'toca_con'  -> 'residente'  the general link. Several at a time.
 *
 * Protected by MIGRATE_SECRET. Call it as:
 *   /api/setup-membership-kinds?secret=YOUR_SECRET&dryRun=1   (report only)
 *   /api/setup-membership-kinds?secret=YOUR_SECRET            (apply)
 *
 * ---------------------------------------------------------------------
 * THE FOUR WAYS THIS GOES WRONG, AND WHAT STOPS EACH
 * ---------------------------------------------------------------------
 *
 * 1. The CHECK blocks it. artist_collectives_kind_check only allows the
 *    two old values, so any write of 'casa' fails on the first row. The
 *    constraint is therefore swapped in the same transaction as the data.
 *
 * 2. The order can DESTROY data. Run 'toca_con'->'residente' first and
 *    every row is 'residente' with no way to tell the originals apart,
 *    ever. Avoided by construction: ONE UPDATE with a CASE, which Postgres
 *    evaluates against each row's OLD value, so both renames happen at the
 *    same instant and no intermediate state exists.
 *
 * 3. The unique index changes meaning. Today it enforces one active
 *    'residente'; tomorrow it must enforce one active 'casa'. Left in
 *    place, the ex-'toca_con' rows would collide the moment they become
 *    'residente'. It is dropped before the swap and recreated on 'casa'.
 *
 * 4. THE SECOND RUN. Our own rule says run every migration twice. A second
 *    pass of "residente -> casa" would convert the NEW residentes (the ex
 *    toca_con) into casa: silent corruption caused by the very procedure
 *    we use to prove correctness. Stopped by the guard below.
 *
 * THE GUARD: the swap runs only while a 'toca_con' row still exists. After
 * a successful run there are none, and the new CHECK forbids creating one,
 * so the guard cannot drift out of sync with the data it guards.
 *
 * The whole swap — drop old CHECK, UPDATE, add new CHECK — goes in ONE
 * transaction, so the table is never left without a constraint on kind.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OLD_CHECK = "artist_collectives_kind_check";
const NEW_CHECK = "artist_collectives_kind_casa_check";
const OLD_INDEX = "artist_collectives_one_active_residency_idx";
const NEW_INDEX = "artist_collectives_one_active_casa_idx";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const kindCounts = async () => {
    const rows = await sql`
      SELECT kind,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE to_date IS NULL)::int AS activos
      FROM artist_collectives GROUP BY kind ORDER BY kind
    `;
    return rows.map((r) => ({
      kind: r.kind as string,
      total: Number(r.total),
      activos: Number(r.activos),
    }));
  };

  try {
    const antes = await kindCounts();

    /**
     * PRE-FLIGHT. An artist holding two active 'residente' links would end
     * up with two active 'casa' links, which the new index refuses. The old
     * index should have made that impossible, but this database is not
     * reachable from a local checkout and "should have" is not a check.
     *
     * Refuse the whole migration rather than fail halfway through it.
     */
    const conflictos = await sql`
      SELECT ac.artist_slug, a.name, COUNT(*)::int AS n,
             string_agg(ac.collective_slug, ', ') AS colectivos
      FROM artist_collectives ac
      JOIN artists a ON a.slug = ac.artist_slug
      WHERE ac.kind = 'residente' AND ac.to_date IS NULL
      GROUP BY ac.artist_slug, a.name
      HAVING COUNT(*) > 1
    `;

    if (conflictos.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          dryRun,
          error:
            "Hay artistas con dos residencias activas. Al renombrar quedarían con dos 'casa', que el índice nuevo rechaza. Resolvelas antes de correr esto.",
          conflictos,
          kindCounts: antes,
        },
        { status: 409 }
      );
    }
    log.push(`pre-flight ok: 0 artistas con dos residencias activas`);

    const pendientes = antes.find((k) => k.kind === "toca_con")?.total ?? 0;
    const seRenombrarian = antes
      .filter((k) => k.kind === "residente" || k.kind === "toca_con")
      .reduce((n, k) => n + k.total, 0);

    if (dryRun) {
      log.push(
        pendientes > 0
          ? `SIMULACIÓN: se renombrarían ${seRenombrarian} filas (${antes.find((k) => k.kind === "residente")?.total ?? 0} residente→casa, ${pendientes} toca_con→residente)`
          : "SIMULACIÓN: no hay filas 'toca_con', la guarda saltearía el renombre (ya migrado)"
      );
      return NextResponse.json({
        ok: true,
        dryRun,
        log,
        conflictos: [],
        renombradas: 0,
        seRenombrarian: pendientes > 0 ? seRenombrarian : 0,
        kindCounts: antes,
      });
    }

    // --- the index, dropped before the swap -----------------------
    // It is about to mean something else, and while it still filters on
    // kind='residente' the ex-toca_con rows would collide against it.
    await sql(`DROP INDEX IF EXISTS ${OLD_INDEX}`);
    log.push(`índice ${OLD_INDEX} eliminado`);

    // --- the swap, atomic ------------------------------------------
    let renombradas = 0;
    if (pendientes > 0) {
      const [, updated] = await sql.transaction([
        sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${OLD_CHECK}`),
        sql`
          UPDATE artist_collectives
          SET kind = CASE kind
                       WHEN 'residente' THEN 'casa'
                       WHEN 'toca_con'  THEN 'residente'
                     END
          WHERE kind IN ('residente', 'toca_con')
          RETURNING id
        `,
        sql(
          `ALTER TABLE artist_collectives ADD CONSTRAINT ${NEW_CHECK} CHECK (kind IN ('casa','residente'))`
        ),
      ]);
      renombradas = (updated as unknown[]).length;
      log.push(`renombradas ${renombradas} filas en una sola sentencia`);
    } else {
      // Already migrated. Only make sure the constraint ended up right —
      // a run that died between steps would leave the old one behind.
      await sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${OLD_CHECK}`);
      await sql(
        `DO $$ BEGIN ALTER TABLE artist_collectives ADD CONSTRAINT ${NEW_CHECK} CHECK (kind IN ('casa','residente')); EXCEPTION WHEN duplicate_object THEN NULL; END $$`
      );
      log.push("guarda activa: no había filas 'toca_con', no se renombró nada");
    }

    // --- the index, recreated on its new meaning -------------------
    await sql(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${NEW_INDEX}
      ON artist_collectives (artist_slug) WHERE kind = 'casa' AND to_date IS NULL
    `);
    log.push(`índice ${NEW_INDEX} creado (una sola casa activa por artista)`);

    const despues = await kindCounts();

    const constraints = await sql`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'artist_collectives'::regclass AND contype = 'c'
      ORDER BY conname
    `;
    const indexes = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'artist_collectives' ORDER BY indexname
    `;

    return NextResponse.json({
      ok: true,
      dryRun,
      log,
      conflictos: [],
      renombradas,
      kindCounts: despues,
      checks: constraints.map((r) => r.conname),
      indices: indexes.map((r) => r.indexname),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, dryRun, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
