/**
 * MIGRATION — CIERRE de la fase 1: se retira el valor transitorio.
 *
 *   /api/setup-cierre-miembros?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-cierre-miembros?secret=YOUR_SECRET
 *
 * ============================================================
 * POR QUÉ ESTO EXISTE Y POR QUÉ NO ES OPCIONAL
 * ============================================================
 *
 * setup-miembros dejó el CHECK aceptando TRES valores —'casa', 'miembro' y
 * 'residente'— para que la migración pudiera correr en main ANTES del
 * deploy del código sin abrir una ventana en la que nadie pudiera aceptar
 * una invitación. El código viejo seguía escribiendo 'residente' y el CHECK
 * lo toleraba.
 *
 * Esta migración cierra eso, y corre DESPUÉS de que el código nuevo esté
 * desplegado. Hace dos cosas:
 *
 *   1. Renombra cualquier fila 'residente' que haya entrado en la ventana.
 *      Se espera CERO, y el número se mide y se reporta: si no es cero,
 *      son filas que el código viejo escribió justo ahí, y el conteo es la
 *      prueba de que la ventana existió y de cuánto duró en filas.
 *   2. Deja el CHECK solo en ('casa','miembro').
 *
 * ============================================================
 * LO QUE PASA SI ESTO NO CORRE: UN VALOR SE VUELVE UN PERMISO
 * ============================================================
 *
 * La fase 2 renombra 'casa' a 'residente', y ahí 'residente' pasa a
 * significar el NÚCLEO del colectivo, con permiso para editarlo.
 *
 * Una fila 'residente' sobreviviente no quedaría como un dato raro que
 * alguien limpia después: quedaría indistinguible de un residente del
 * núcleo, con permiso de edición sobre un colectivo al que nadie la
 * invitó. Y no habría forma de separarla de las legítimas, porque después
 * del renombre las dos dicen exactamente lo mismo.
 *
 * Por eso la migración de la fase 2 comprueba en su dryRun que no existe
 * NINGUNA fila 'residente' y se niega a correr si encuentra alguna. Este
 * cierre es lo que hace que esa comprobación pueda pasar.
 *
 * Un valor transitorio que no se cierra se convierte en un permiso.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSITORIO = "residente";
const NUEVO = "miembro";
const CHECK = "artist_collectives_kind_valores_check";
/** El definitivo: dos valores, sin el transitorio. */
const DEF_FINAL = `CHECK ((kind = ANY (ARRAY['casa'::text, '${NUEVO}'::text])))`;

type Estado = {
  porKind: Record<string, number>;
  transitorias: number;
  checks: string[];
  total: number;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  if (e.transitorias > 0) {
    p.push(`quedan ${e.transitorias} filas con kind='${TRANSITORIO}'`);
  }

  const linea = e.checks.find((x) => x.startsWith(`${CHECK}: `));
  if (!linea) p.push(`falta el CHECK ${CHECK}`);
  else {
    const real = linea.slice(CHECK.length + 2);
    if (real !== DEF_FINAL) {
      p.push(
        `el CHECK ${CHECK} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${DEF_FINAL}`
      );
    }
  }
  return { ok: p.length === 0, problemas: p };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const estado = async (): Promise<Estado> => {
    const filas = await sql`SELECT kind, COUNT(*)::int AS n FROM artist_collectives GROUP BY 1 ORDER BY 1`;
    const cons = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'artist_collectives'::regclass AND contype = 'c' ORDER BY conname
    `;
    const [t] = await sql`SELECT COUNT(*)::int AS n FROM artist_collectives`;
    const porKind = Object.fromEntries(filas.map((f) => [f.kind as string, f.n as number]));
    return {
      porKind,
      transitorias: porKind[TRANSITORIO] ?? 0,
      checks: cons.map((c) => `${c.conname}: ${c.def}`),
      total: t.n as number,
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está cerrado. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push(
        antes.transitorias === 0
          ? `SIMULACIÓN: CERO filas '${TRANSITORIO}'. La ventana entre la migración y el deploy estuvo limpia: ningún cliente alcanzó a escribir el valor viejo.`
          : `SIMULACIÓN: hay ${antes.transitorias} filas '${TRANSITORIO}' que el código viejo escribió en la ventana. Se renombran a '${NUEVO}'. Mirá el número: es la medida de la ventana.`
      );
      log.push(`Después de esto el CHECK deja de aceptar '${TRANSITORIO}'.`);
      log.push(`Por kind: ${JSON.stringify(antes.porKind)}, total ${antes.total}.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        transitoriasPendientes: antes.transitorias,
        estado: antes,
        log,
      });
    }

    /**
     * LOS TRES PASOS EN UNA TRANSACCIÓN, y el orden importa igual que en
     * setup-miembros: el CHECK de dos valores no se puede poner mientras
     * existan filas 'residente', así que primero se dropea la guarda,
     * después se renombra, y recién al final entra la definitiva.
     *
     * La guarda del UPDATE es el valor transitorio, que el código nuevo ya
     * no escribe: se consume una vez y no se recrea.
     */
    const [, actualizadas] = await sql.transaction([
      sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${CHECK}`),
      sql`UPDATE artist_collectives SET kind = ${NUEVO} WHERE kind = ${TRANSITORIO} RETURNING id`,
      sql(`ALTER TABLE artist_collectives ADD CONSTRAINT ${CHECK} ${DEF_FINAL}`),
    ]);
    const renombradas = (actualizadas as unknown[]).length;

    log.push(
      renombradas === 0
        ? `CERO filas '${TRANSITORIO}' para renombrar: la ventana estuvo limpia, medido y no supuesto.`
        : `ATENCIÓN: se renombraron ${renombradas} filas '${TRANSITORIO}' que entraron en la ventana. No es un error —para eso estaba el transitorio— pero es el número que dice cuánto se usó.`
    );
    log.push(`CHECK cerrado en ('casa','${NUEVO}'): el valor transitorio ya no se puede escribir.`);

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: cero filas '${TRANSITORIO}' y el CHECK definitivo con su definición exacta. La fase 2 ya puede correr.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const problemasDatos: string[] = [];
    if (antes.total !== despues.total) {
      problemasDatos.push(`el total pasó de ${antes.total} a ${despues.total}`);
    }
    if ((antes.porKind.casa ?? 0) !== (despues.porKind.casa ?? 0)) {
      problemasDatos.push(
        `las filas 'casa' pasaron de ${antes.porKind.casa ?? 0} a ${despues.porKind.casa ?? 0}`
      );
    }
    for (const x of problemasDatos) log.push(`ATENCIÓN: ${x}`);
    if (problemasDatos.length === 0) {
      log.push(`Datos cuadrados: ${JSON.stringify(despues.porKind)}, total ${despues.total}.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && problemasDatos.length === 0,
      problemas: [...v.problemas, ...problemasDatos],
      renombradas,
      antes,
      despues,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
