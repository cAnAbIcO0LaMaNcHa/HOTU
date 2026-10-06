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

/**
 * ============================================================
 * DOS PUERTAS, CON PODERES DISTINTOS A PROPÓSITO
 * ============================================================
 *
 * A MANO, con MIGRATE_SECRET en la query: puede hacer dryRun y puede purgar.
 * EL SCHEDULER, con Authorization: Bearer CRON_SECRET: SOLO puede purgar.
 *
 * ============================================================
 * POR QUÉ UNA TERCERA LLAVE Y NO MIGRATE_SECRET
 * ============================================================
 *
 * No es prolijidad: es que NO HAY FORMA de que un cron de Vercel mande un query param
 * secreto. Los crons se declaran en vercel.json, que se COMMITEA al repo, así que poner
 * ?secret=... ahí publicaría la llave que altera el esquema de producción y que es la
 * segunda llave de la limpieza que borra pedidos y boletas.
 *
 * Vercel manda `Authorization: Bearer ${CRON_SECRET}` en cada invocación —verificado en su
 * documentación, no de memoria— y ese es el camino que no deja el secreto en ningún archivo.
 *
 * Y es la misma decisión que el repo ya tomó dos veces: MIGRATE_SECRET abre el esquema y la
 * plata, SMOKE_SECRET solo lee. Poderes distintos, llaves distintas. Un scheduler que corre
 * solo todos los días no tiene por qué cargar la llave con la que se borran boletas.
 *
 * SIRVE IGUAL PARA UN GITHUB ACTION, y por eso este código no depende de cuál gane: un
 * Action manda el mismo header con la llave desde los secrets del repo. El disparador se
 * elige afuera; la puerta es la misma.
 *
 * ============================================================
 * FALLA CERRADO
 * ============================================================
 *
 * Si CRON_SECRET no está en el entorno, la puerta del scheduler NO EXISTE: `!cronSecret`
 * corta antes de comparar. El default de un camino automático que destruye contenido es
 * "no", igual que VENTA_ONLINE.
 *
 * Y el `!authHeader` no alcanza solo: sin el `!cronSecret`, un entorno sin la variable
 * compararía `"Bearer undefined"` contra el header, que es exactamente el tipo de
 * comparación que un día alguien satisface por accidente.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dryRunPedido = searchParams.get("dryRun") === "1";

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const esCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  const esManual =
    Boolean(process.env.MIGRATE_SECRET) &&
    searchParams.get("secret") === process.env.MIGRATE_SECRET;

  if (!esCron && !esManual) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /**
   * EL CRON NO PUEDE PEDIR dryRun, Y SE LE DICE EN VEZ DE IGNORARLO.
   *
   * Ignorarlo sería peor: alguien que configure el cron apuntando a ?dryRun=1 creería estar
   * simulando y en realidad estaría purgando. Y al revés —tratarlo como simulación— dejaría
   * un cron que corre todos los días sin purgar nunca, que es el agujero que esta pieza
   * vino a tapar: una retención que no pasa.
   *
   * Un 400 ruidoso al primer intento es la única de las tres opciones que se nota.
   */
  if (esCron && dryRunPedido) {
    return NextResponse.json(
      {
        error:
          "El scheduler no puede pedir dryRun: o simula y entonces la retención no pasa " +
          "nunca, o purga y entonces quien lo configuró creyó que simulaba. Sacá dryRun del " +
          "path del cron, o corré la simulación a mano con MIGRATE_SECRET.",
      },
      { status: 400 }
    );
  }

  const dryRun = dryRunPedido && esManual;
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
