/**
 * GET /api/mantenimiento-mail-outbox?secret=MIGRATE_SECRET[&dryRun=1]
 *
 * Vacía asunto y cuerpo de las filas de mail_outbox que pasaron los 90 días, conservando que
 * el aviso salió, a quién y cuándo. El trabajo vive en lib/mail-retencion.ts.
 *
 * ============================================================
 * VA CON MIGRATE_SECRET Y NO CON SMOKE_SECRET
 * ============================================================
 *
 * Las dos llaves son poderes distintos y está escrito en AGENTS.md: SMOKE_SECRET solo LEE y
 * devuelve conteos. Esto ESCRIBE, y lo que escribe es irreversible — el cuerpo vaciado no
 * vuelve. Darle la llave de lectura a algo que destruye dato sería exactamente al revés de
 * por qué hay dos.
 *
 * ============================================================
 * ES UNA RUTA DE MANTENIMIENTO, NO UNA MIGRACIÓN
 * ============================================================
 *
 * No se llama setup-* a propósito: no cambia el esquema y no se corre una vez. Se corre
 * periódicamente, y cada corrida purga lo que cumplió el plazo desde la anterior. El esquema
 * que la habilita lo dejó setup-retencion-mail-outbox.
 *
 * TIENE dryRun porque borra contenido: antes de vaciar nada conviene poder ver CUÁNTAS filas
 * se va a llevar. El dryRun cuenta exactamente lo que la corrida real purgaría — la misma
 * consulta, sin el UPDATE.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { DIAS_DE_RETENCION, purgarMailOutbox } from "@/lib/mail-retencion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  try {
    /**
     * SE COMPRUEBA QUE EL ESQUEMA ESTÉ ANTES DE INTENTAR, y se devuelve 409 en vez de dejar
     * que el UPDATE falle con un error de Postgres. Sin purgado_en la purga no puede ni
     * registrarse, y un 500 con "column purgado_en does not exist" manda a buscar un bug de
     * código cuando lo que falta es correr una migración.
     */
    const [col] = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mail_outbox' AND column_name = 'purgado_en'`;
    if (!col) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Falta mail_outbox.purgado_en. Corré setup-retencion-mail-outbox primero: sin esa " +
            "columna la purga no puede quedar registrada.",
        },
        { status: 409 }
      );
    }

    const r = await purgarMailOutbox(sql, { dryRun });

    log.push(
      dryRun
        ? `SIMULACIÓN: se purgaría el contenido de ${r.purgadas} fila(s) de más de ${DIAS_DE_RETENCION} días.`
        : `PURGADAS ${r.purgadas} fila(s): asunto y cuerpo en NULL, purgado_en con la fecha.`
    );
    log.push(
      `Quedan ${r.vivas} con contenido y ${r.yaPurgadas} ya estaban purgadas antes de esta corrida.`
    );
    log.push(
      r.masViejaViva
        ? `La más vieja con contenido es del ${r.masViejaViva} — tiene que estar dentro de los ${DIAS_DE_RETENCION} días.`
        : "No queda ninguna fila con contenido."
    );
    log.push("LO QUE NO CADUCA: tipo, para, estado, motivo, referencia y creado_en. Que el aviso salió es prueba.");

    return NextResponse.json({ ok: true, dryRun, dias: DIAS_DE_RETENCION, ...r, log });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
