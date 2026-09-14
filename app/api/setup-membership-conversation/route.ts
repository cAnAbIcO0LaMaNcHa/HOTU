/**
 * MIGRATION — TANDA 3, PIEZA 3: membership becomes a conversation.
 *
 * Protected by MIGRATE_SECRET. Call it as:
 *   /api/setup-membership-conversation?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-membership-conversation?secret=YOUR_SECRET
 *
 * Purely additive: two nullable-or-defaulted columns, one CHECK and one
 * index. Nothing is dropped, rewritten or moved.
 *
 * A membership only counts with both sides agreeing (§3). The states are
 * read off the timestamps rather than a status column:
 *
 *   pendiente  accepted_at IS NULL AND rejected_at IS NULL AND to_date IS NULL
 *   aceptada   accepted_at IS NOT NULL AND to_date IS NULL
 *   rechazada  rejected_at IS NOT NULL   (and to_date set, see below)
 *   cerrada    to_date IS NOT NULL
 *
 * requested_by records WHO STARTED the conversation, which a single status
 * column could not: the same pending row has to read as "te invitaron" on
 * one side and "se postuló" on the other.
 *
 * NO decided_at column. It would be exactly COALESCE(accepted_at,
 * rejected_at) — a third copy of a fact already stored twice, and the kind
 * of redundancy that drifts the first time one path forgets to write it.
 *
 * Rejection sets BOTH rejected_at and to_date. That keeps one single
 * liveness predicate — to_date IS NULL — for every query in the codebase,
 * and it frees the (artist, collective, kind) unique index so a rejected
 * artist can be invited again later.
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

  const ensureConstraint = async (label: string, alterStatement: string) => {
    await sql(
      `DO $$ BEGIN ${alterStatement}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    );
    log.push(label);
  };

  const estado = async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='artist_collectives'
        AND column_name IN ('requested_by','rejected_at','canceled_at')
      ORDER BY column_name
    `;
    const [counts] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS aceptadas,
        COUNT(*) FILTER (WHERE accepted_at IS NULL AND to_date IS NULL)::int AS sin_aceptar
      FROM artist_collectives
    `;
    return {
      columnasNuevas: cols.map((c) => c.column_name as string),
      filas: {
        total: Number(counts.total),
        aceptadas: Number(counts.aceptadas),
        sinAceptar: Number(counts.sin_aceptar),
      },
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const faltan = ["requested_by", "rejected_at", "canceled_at"].filter(
        (c) => !antes.columnasNuevas.includes(c)
      );
      log.push(
        faltan.length > 0
          ? `SIMULACIÓN: se agregarían las columnas ${faltan.join(", ")}`
          : "SIMULACIÓN: las columnas ya existen, no habría cambios"
      );
      log.push(
        `SIMULACIÓN: ${antes.filas.aceptadas} de ${antes.filas.total} filas ya tienen accepted_at y quedan como aceptadas`
      );
      return NextResponse.json({ ok: true, dryRun, log, estado: antes, seAgregarian: faltan });
    }

    /**
     * Who opened the conversation. The default is 'collective' because
     * every row that exists today came from the collective's side — the
     * jsonb the collective maintained, or an admin adding someone — so it
     * is the honest backfill rather than a convenient one.
     */
    await sql`
      ALTER TABLE artist_collectives
      ADD COLUMN IF NOT EXISTS requested_by TEXT NOT NULL DEFAULT 'collective'
    `;
    await sql`ALTER TABLE artist_collectives ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ`;

    /**
     * canceled_at is its own column, not a reuse of rejected_at.
     *
     * Withdrawing and being turned down are different events and the
     * history has to say which. requested_by records who STARTED the
     * conversation but not who ACTED on it, so after the fact a single
     * timestamp could not tell "the collective changed its mind" from
     * "the DJ said no" — the distinction would be lost permanently.
     */
    await sql`ALTER TABLE artist_collectives ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ`;
    log.push("columnas requested_by, rejected_at y canceled_at listas");

    await ensureConstraint(
      "check de requested_by listo",
      `ALTER TABLE artist_collectives
         ADD CONSTRAINT artist_collectives_requested_by_check
         CHECK (requested_by IN ('artist', 'collective'))`
    );

    // At most ONE outcome per row. The earlier version of this check only
    // knew about accepted/rejected; it is replaced rather than added to,
    // so there is never a moment with two overlapping definitions of the
    // same rule.
    await sql`
      ALTER TABLE artist_collectives
      DROP CONSTRAINT IF EXISTS artist_collectives_one_decision_check
    `;
    await ensureConstraint(
      "check de resultado único listo",
      `ALTER TABLE artist_collectives
         ADD CONSTRAINT artist_collectives_one_outcome_check
         CHECK (
           (CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END)
         + (CASE WHEN rejected_at IS NOT NULL THEN 1 ELSE 0 END)
         + (CASE WHEN canceled_at IS NOT NULL THEN 1 ELSE 0 END) <= 1
         )`
    );

    // Pending rows are read on every profile and every collective panel:
    // "what is waiting for me". Partial, because they are a small slice.
    await sql`
      CREATE INDEX IF NOT EXISTS artist_collectives_pendientes_idx
      ON artist_collectives (artist_slug, collective_slug)
      WHERE accepted_at IS NULL AND rejected_at IS NULL AND canceled_at IS NULL AND to_date IS NULL
    `;
    log.push("índice de pendientes listo");

    const despues = await estado();
    log.push(
      `${despues.filas.aceptadas} de ${despues.filas.total} filas quedan como aceptadas, ${despues.filas.sinAceptar} pendientes`
    );

    return NextResponse.json({ ok: true, dryRun, log, estado: despues });
  } catch (err) {
    return NextResponse.json(
      { ok: false, dryRun, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
