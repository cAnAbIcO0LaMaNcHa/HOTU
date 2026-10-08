/**
 * EL BARRIDO DE CONVOCATORIAS VENCIDAS.
 *
 * Cierra el REGISTRO de las convocatorias que ya están cerradas de hecho, y rechaza sus
 * pendientes. Node-only.
 *
 * ============================================================
 * EL PERMISO NO LO DECIDE ESTO, Y ESA ES TODA LA DIVISIÓN
 * ============================================================
 *
 * Una convocatoria deja de aceptar postulaciones EN EL INSTANTE en que se le pasa el cierre o
 * pasa la fiesta, porque eso se DERIVA en el WHERE de cada lector y del write path
 * —CONVOCATORIA_ABIERTA en lib/convocatorias.ts—. Este barrido no agrega ni un permiso: lo
 * único que hace es poner por escrito algo que ya era cierto.
 *
 * SI EL CRON NO CORRIERA NUNCA, NADIE PODRÍA POSTULARSE A UNA CONVOCATORIA VENCIDA. Lo que
 * pasaría es que su fila seguiría diciendo cerrada_en IS NULL y sus postulaciones quedarían
 * pendientes para siempre, o sea gente esperando una respuesta que nadie le va a dar. Eso es
 * lo que el barrido arregla, y es por qué hace falta aunque no sea una puerta.
 *
 * Es al revés de lo que parece natural, y conviene decirlo: la tentación es que el cron
 * escriba el estado y que los lectores lo lean. Con un cron diario eso deja una ventana de
 * hasta 24 horas en la que la convocatoria acepta postulaciones después de su propio cierre.
 *
 * ============================================================
 * cerrada_por QUEDA EN NULL, Y SIGNIFICA ALGO
 * ============================================================
 *
 * Una convocatoria con cerrada_en puesta y cerrada_por en NULL es una que cerró el barrido, no
 * una persona. El CHECK event_calls_cerrada_coherente_check permite exactamente eso —autor sin
 * hecho no, hecho sin autor sí— y es la misma distinción que account_removals.measured en
 * NULL: información, no un hueco.
 *
 * El motivo de los rechazos también queda en NULL, por lo mismo que al cerrar a mano: no lo
 * escribió nadie.
 */

import { neon } from "@neondatabase/serverless";
import { HOY_EN_BOGOTA } from "./convocatorias";
import { enviar } from "./mail";

const sql = neon(process.env.DATABASE_URL!);

export type ResumenBarrido = {
  convocatorias: number;
  postulaciones: number;
  /** Los avisos que se dejaron en mail_outbox, contados aparte de las filas resueltas. */
  avisos: number;
};

/**
 * La condición de VENCIDA, que es la negación de abierta SIN la parte que ya está escrita.
 *
 * No incluye `cerrada_en IS NULL` porque eso va en el WHERE de cada sentencia: acá describe
 * por QUÉ venció, y hay dos motivos distintos que conviene poder contar por separado.
 */
/**
 * TOMA EL ALIAS COMO PARÁMETRO y no se lo parchea con un replace. La primera versión hacía
 * un replace de expresión regular sobre el texto de la condición para reusarla en una
 * subconsulta, y eso es un sed sobre SQL: el día que la condición mencione otra tabla cuyo
 * alias empiece igual, el replace la toca también y la consulta cambia de significado sin
 * fallar.
 */
const vencida = (ec: string, e: string) =>
  `(${ec}.cierra_en IS NOT NULL AND ${ec}.cierra_en <= now()) ` +
  `OR ${e}.event_date < ${HOY_EN_BOGOTA}`;

/**
 * Cierra las vencidas y rechaza sus pendientes.
 *
 * LAS DOS COSAS EN UNA TRANSACCIÓN, por lo mismo que al cerrar a mano: una convocatoria
 * cerrada con pendientes adentro es un estado en el que nadie va a responderle a esa gente y
 * nada lo dice.
 *
 * `dryRun` cuenta sin escribir, y cuenta LO MISMO que la corrida real escribiría — las mismas
 * dos consultas, sin los UPDATE. Un dryRun que cuenta otra cosa es peor que no tenerlo.
 */
export async function barrerConvocatorias(
  dryRun: boolean
): Promise<{ resumen: ResumenBarrido; log: string[] }> {
  const log: string[] = [];

  if (dryRun) {
    const [c] = await sql(
      `SELECT COUNT(*)::int AS n FROM event_calls ec JOIN events e ON e.id = ec.event_id
       WHERE ec.cerrada_en IS NULL AND (${vencida("ec", "e")})`
    );
    const [p] = await sql(
      `SELECT COUNT(*)::int AS n
       FROM event_applications ea
       JOIN event_calls ec ON ec.id = ea.call_id
       JOIN events e ON e.id = ec.event_id
       WHERE ea.resuelta_en IS NULL AND ec.cerrada_en IS NULL AND (${vencida("ec", "e")})`
    );
    log.push(
      `SIMULACIÓN: cerraría ${c.n} convocatoria(s) vencida(s) y rechazaría ${p.n} ` +
        "postulación(es) pendiente(s). No se escribió nada."
    );
    return {
      resumen: { convocatorias: c.n as number, postulaciones: p.n as number, avisos: 0 },
      log,
    };
  }

  /**
   * EL ORDEN ES: PRIMERO LAS POSTULACIONES, DESPUÉS LAS CONVOCATORIAS.
   *
   * Si las convocatorias se cerraran primero, la segunda sentencia ya no las vería como
   * vencidas-y-abiertas y las pendientes quedarían colgadas. Las dos están en la misma
   * transacción, pero dentro de una transacción el orden sí cambia lo que cada una ve.
   *
   * Y el RETURNING trae artist_slug para poder avisar: sin él, "se rechazaron N" sería un
   * número sin a quién avisarle.
   */
  const [rechazadas, cerradas] = await sql.transaction([
    sql(
      `UPDATE event_applications ea
       SET resuelta_en = now(), resultado = 'rechazada'
       WHERE ea.resuelta_en IS NULL
         AND ea.call_id IN (
           SELECT ec.id FROM event_calls ec JOIN events e ON e.id = ec.event_id
           WHERE ec.cerrada_en IS NULL AND (${vencida("ec", "e")})
         )
       RETURNING ea.id, ea.artist_slug, ea.call_id`
    ),
    sql(
      `UPDATE event_calls ec
       SET cerrada_en = now()
       WHERE ec.cerrada_en IS NULL
         AND ec.id IN (
           SELECT ec2.id FROM event_calls ec2 JOIN events e ON e.id = ec2.event_id
           WHERE ec2.cerrada_en IS NULL AND (${vencida("ec2", "e")})
         )
       RETURNING ec.id`
    ),
  ]);

  const filasR = rechazadas as Array<{ id: number; artist_slug: string; call_id: number }>;
  const filasC = cerradas as Array<{ id: number }>;

  /**
   * Y LOS AVISOS, QUE SON LA RAZÓN DE SER DEL BARRIDO.
   *
   * Una postulación que el barrido rechaza es alguien que estaba esperando respuesta, así
   * que el aviso NO es decoración: es lo que convierte el barrido en una respuesta. Sin
   * esto, la fila quedaría resuelta y el DJ se enteraría mirando la web por su cuenta, o no
   * se enteraría.
   *
   * FUERA DE LA TRANSACCIÓN, igual que todos los avisos del repo: sería darle a un aviso el
   * poder de deshacer el barrido.
   *
   * Y SE CUENTAN DE VERDAD. La primera versión devolvía `avisos: 0` fijo mientras el log
   * hablaba de rechazos — un log que afirma sin medir, que es justo lo que este repo no
   * permite. Los avisos pueden ser MENOS que los rechazos y eso es correcto: un perfil
   * desamparado no tiene a quién avisarle, y el log lo dice con el número.
   */
  let avisos = 0;
  if (filasR.length > 0) {
    const datos = await sql(
      `SELECT ea.id, ar.owner_email, ar.name, ar.slug, e.title, ec.collective_slug
       FROM event_applications ea
       JOIN event_calls ec ON ec.id = ea.call_id
       JOIN events e ON e.id = ec.event_id
       JOIN artists ar ON ar.slug = ea.artist_slug
       WHERE ea.id = ANY($1::int[]) AND ar.owner_email IS NOT NULL`,
      [filasR.map((f) => f.id)]
    );
    for (const d of datos) {
      try {
        await enviar({
          tipo: "postulacion_rechazada",
          para: d.owner_email as string,
          artista: { tipo: "artist", slug: d.slug as string, nombre: d.name as string },
          evento: d.title as string,
          colectivo: d.collective_slug as string,
          motivo: null,
        });
        avisos++;
      } catch (err) {
        console.error(`no pude avisar el rechazo de la postulación ${d.id}`, err);
      }
    }
  }

  log.push(
    `Cerradas ${filasC.length} convocatoria(s) vencida(s), con cerrada_por en NULL porque las ` +
      `cerró el barrido y no una persona. Rechazadas ${filasR.length} postulación(es) ` +
      `pendiente(s), sin motivo porque no lo escribió nadie. Avisos dejados: ${avisos}` +
      (avisos < filasR.length
        ? ` (menos que los rechazos: ${filasR.length - avisos} perfil(es) sin dueño a quien avisarle).`
        : ".")
  );

  return {
    resumen: {
      convocatorias: filasC.length,
      postulaciones: filasR.length,
      avisos,
    },
    log,
  };
}
