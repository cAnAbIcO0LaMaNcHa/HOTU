/**
 * GET /api/mantenimiento-convocatorias?secret=MIGRATE_SECRET[&dryRun=1]
 * GET /api/mantenimiento-convocatorias   con Authorization: Bearer CRON_SECRET
 *
 * Cierra el registro de las convocatorias vencidas y rechaza sus pendientes. El trabajo vive
 * en lib/convocatorias-barrido.ts.
 *
 * ============================================================
 * ESTO NO ES UNA PUERTA: EL PERMISO SE DERIVA AL LEER
 * ============================================================
 *
 * Una convocatoria deja de aceptar postulaciones EN EL INSTANTE en que se le pasa el cierre o
 * pasa la fiesta, porque CONVOCATORIA_ABIERTA se evalúa en el WHERE de cada lector y del write
 * path. Si este cron no corriera nunca, NADIE podría postularse a una convocatoria vencida.
 *
 * Lo que arregla el barrido es otra cosa, y es la que importa: sin él, esas postulaciones
 * quedarían PENDIENTES para siempre — gente esperando una respuesta que nadie le va a dar. El
 * barrido es la respuesta.
 *
 * Por eso tiene avisos y no solo UPDATEs. Un barrido que resolviera las filas en silencio
 * dejaría al DJ enterándose por mirar la web, o no enterándose.
 *
 * ============================================================
 * LA PUERTA ES LA MISMA QUE LA DE mail-outbox
 * ============================================================
 *
 * Vive en lib/cron-auth.ts, con su razonamiento entero: a mano con MIGRATE_SECRET se puede
 * simular y barrer; el scheduler con Bearer CRON_SECRET SOLO puede barrer; y falla cerrado si
 * la variable no está. Se extrajo justamente al escribir esta ruta — dos copias de una regla
 * de permisos es una regla que un día se desincroniza.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { abrirPuertaDeMantenimiento } from "@/lib/cron-auth";
import { barrerConvocatorias } from "@/lib/convocatorias-barrido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const puerta = abrirPuertaDeMantenimiento(request);
  if (!puerta.ok) {
    return NextResponse.json({ error: puerta.error }, { status: puerta.status });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  try {
    /**
     * SE COMPRUEBA QUE EL ESQUEMA ESTÉ, y se devuelve 409 en vez de dejar que el UPDATE falle.
     * Mismo criterio que la ruta de mail-outbox: un 500 con "relation event_calls does not
     * exist" manda a buscar un bug de código cuando lo que falta es correr una migración.
     */
    const tablas = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('event_calls', 'event_applications')`;
    if (tablas.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Faltan event_calls o event_applications. Corré setup-convocatorias primero: sin " +
            "esas tablas no hay nada que barrer.",
        },
        { status: 409 }
      );
    }

    const { resumen, log: logBarrido } = await barrerConvocatorias(puerta.dryRun);
    log.push(...logBarrido);

    /**
     * Y SE VERIFICA QUE NO QUEDE NADA, en la corrida real. Es la mitad que vuelve al log una
     * medición y no una afirmación: después de barrer, la misma consulta del dryRun tiene que
     * dar cero. Si diera más, el barrido dejó algo y el log lo dice en vez de celebrar.
     */
    let verificado = true;
    if (!puerta.dryRun) {
      const { resumen: quedan } = await barrerConvocatorias(true);
      verificado = quedan.convocatorias === 0 && quedan.postulaciones === 0;
      log.push(
        verificado
          ? "VERIFICADO: no quedan convocatorias vencidas sin cerrar ni pendientes en ellas."
          : `NO VERIFICADO: quedaron ${quedan.convocatorias} convocatoria(s) y ` +
              `${quedan.postulaciones} postulación(es) que el barrido tendría que haberse llevado.`
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: puerta.dryRun,
      via: puerta.via,
      verificado,
      resumen,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
