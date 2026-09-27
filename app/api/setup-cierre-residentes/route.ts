/**
 * MIGRATION — CIERRE de la fase 2: se retira 'casa'.
 *
 *   /api/setup-cierre-residentes?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-cierre-residentes?secret=YOUR_SECRET
 *
 * ============================================================
 * ESTE CIERRE NO RENOMBRA NADA. Y ES LO CONTRARIO DEL DE LA FASE 1.
 * ============================================================
 *
 * setup-cierre-miembros SÍ renombraba lo que encontraba, y estaba bien: una
 * fila 'residente' escrita por el código viejo significaba, en el vocabulario
 * viejo, exactamente lo que 'miembro' significa ahora — el vínculo general.
 * Renombrarla no cambiaba lo que decía de nadie.
 *
 * Acá no. Mientras el código viejo siga en producción, chooseKind deja que un
 * DJ elija 'casa' POR SU CUENTA — su comentario lo dice: "Solo el DJ elige si
 * un colectivo es su casa". Así que una fila 'casa' nacida en esta ventana la
 * eligió el DJ, NO la invitó el dueño.
 *
 * Y después de la fase 2, 'residente' no es una etiqueta: es PERMISO PARA
 * EDITAR el colectivo. Convertir esas filas automáticamente sería darle
 * permiso de edición a alguien a quien el dueño nunca invitó, en silencio,
 * desde una migración. El renombre preserva la palabra y cambia el poder que
 * la palabra otorga.
 *
 * Entonces:
 *
 *   0 filas 'casa'  -> se cierra el CHECK en ('miembro','residente').
 *   alguna          -> 409 con la lista (DJ, colectivo, quién lo pidió,
 *                      fecha) y NO SE TOCA NADA.
 *
 * Lo esperable al resolverlas a mano es pasarlas a 'miembro' y que el dueño
 * invite si corresponde. Eso no lo decide una migración: decidir si alguien
 * merece editar un colectivo ajeno es de una persona.
 *
 * ============================================================
 * POR QUÉ NO SE "ARREGLA SOLO" PASÁNDOLAS A miembro
 * ============================================================
 *
 * Porque tampoco es gratis. Esas filas son vínculos que el DJ eligió, y
 * degradarlas sin avisar le saca algo que para él ya estaba hecho. La
 * diferencia con renombrar es que degradar no concede permisos — pero sigue
 * siendo una decisión sobre el vínculo de dos personas, y el que la toma
 * tiene que poder verla. Por eso 409 con la lista y no un UPDATE callado.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEJO = "casa";
const MIEMBRO = "miembro";
const RESIDENTE = "residente";

const CHECK = "artist_collectives_kind_valores_check";
const DEF_FINAL = `CHECK ((kind = ANY (ARRAY['${MIEMBRO}'::text, '${RESIDENTE}'::text])))`;

type Estado = {
  porKind: Record<string, number>;
  casas: number;
  checks: string[];
  total: number;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (e.casas > 0) p.push(`quedan ${e.casas} filas con kind='${VIEJO}'`);

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
      casas: porKind[VIEJO] ?? 0,
      checks: cons.map((c) => `${c.conname}: ${c.def}`),
      total: t.n as number,
    };
  };

  try {
    const antes = await estado();

    /**
     * LA GUARDA, EN LOS DOS CAMINOS. Ver la cabecera: estas filas las eligió
     * el DJ, y convertirlas a 'residente' le daría permiso de edición sin que
     * el dueño lo haya invitado.
     */
    if (antes.casas > 0) {
      const cuales = await sql`
        SELECT id, artist_slug, collective_slug, requested_by, from_date,
               accepted_at, to_date
        FROM artist_collectives WHERE kind = ${VIEJO} ORDER BY id
      `;
      return NextResponse.json(
        {
          ok: false,
          verificado: false,
          error:
            `HAY ${antes.casas} fila(s) con kind='${VIEJO}', y este cierre NO las convierte. ` +
            `Mientras el código viejo estuvo en producción, chooseKind dejaba que el DJ eligiera ` +
            `'${VIEJO}' por su cuenta, así que estas las eligió él y no las invitó el dueño. ` +
            `Renombrarlas a '${RESIDENTE}' les daría PERMISO PARA EDITAR el colectivo sin que ` +
            `nadie los haya invitado. Resolvelas a mano —lo esperable es pasarlas a '${MIEMBRO}' ` +
            "y que el dueño invite si corresponde— y volvé.",
          filas: cuales,
          log,
        },
        { status: 409 }
      );
    }

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está cerrado. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push(
        `GUARDA OK: cero filas '${VIEJO}'. Nadie eligió su propio núcleo en la ventana, así que ` +
          "no hay ningún permiso que se estaría regalando."
      );
      log.push(`Después de esto el CHECK deja de aceptar '${VIEJO}'.`);
      log.push(`Por kind: ${JSON.stringify(antes.porKind)}, total ${antes.total}.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        casasPendientes: antes.casas,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /**
     * SOLO EL SWAP DEL CHECK, sin UPDATE de datos. Las dos sentencias van
     * juntas: sin la transacción hay una ventana de un round-trip sin guarda,
     * y si el ADD falla no se cierra nunca.
     *
     * Y el ADD no puede fallar por datos: la guarda de arriba ya garantizó
     * que no queda ninguna fila con el valor que el CHECK nuevo rechaza.
     */
    await sql.transaction([
      sql(`ALTER TABLE artist_collectives DROP CONSTRAINT IF EXISTS ${CHECK}`),
      sql(`ALTER TABLE artist_collectives ADD CONSTRAINT ${CHECK} ${DEF_FINAL}`),
    ]);
    log.push(
      `CHECK cerrado en ('${MIEMBRO}','${RESIDENTE}'): '${VIEJO}' ya no se puede escribir. ` +
        "Ninguna fila se tocó — este cierre no renombra."
    );

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: cero filas '${VIEJO}' y el CHECK definitivo con su definición exacta. El renombre está cerrado.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const problemasDatos: string[] = [];
    if (antes.total !== despues.total) {
      problemasDatos.push(`el total pasó de ${antes.total} a ${despues.total}`);
    }
    for (const k of [MIEMBRO, RESIDENTE]) {
      if ((antes.porKind[k] ?? 0) !== (despues.porKind[k] ?? 0)) {
        problemasDatos.push(
          `las filas '${k}' pasaron de ${antes.porKind[k] ?? 0} a ${despues.porKind[k] ?? 0}`
        );
      }
    }
    for (const x of problemasDatos) log.push(`ATENCIÓN: ${x}`);
    if (problemasDatos.length === 0) {
      log.push(`Datos intactos: ${JSON.stringify(despues.porKind)}, total ${despues.total}.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && problemasDatos.length === 0,
      problemas: [...v.problemas, ...problemasDatos],
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
