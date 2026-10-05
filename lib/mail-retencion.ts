/**
 * LA RETENCIÓN DE mail_outbox: 90 DÍAS DE CONTENIDO, REGISTRO PARA SIEMPRE.
 *
 * El plazo y la purga viven acá y no en la ruta, por la regla del repo: la ruta hace auth y
 * forma, el lib hace el trabajo. Así la app móvil o un cron podrían llamar lo mismo.
 *
 * ============================================================
 * QUÉ CADUCA Y QUÉ NO, QUE ES TODA LA DECISIÓN
 * ============================================================
 *
 * SE VACÍAN asunto y cuerpo. Son el texto de lo que se le dijo a una persona: dato personal
 * bajo la Ley 1581 de 2012, la misma razón por la que no se guarda la cédula. A los 90 días
 * ya no hace falta poder citarlo palabra por palabra.
 *
 * SE CONSERVAN tipo, para, estado, motivo, referencia y creado_en. Eso es la PRUEBA de que
 * el aviso salió, a quién y cuándo, y no puede caducar: borrar la fila entera dejaría a HOTU
 * sin poder demostrar que avisó, que es justamente el reclamo del que la tabla protege.
 *
 * Por eso esto no es un DELETE. Un DELETE habría sido más corto y habría tirado la mitad
 * que importa.
 */

/**
 * NOVENTA DÍAS. El plazo vive en UNA constante y no repetido en la consulta y en el texto de
 * la pantalla: dos copias de un plazo es cómo un día la purga corre a 90 y la página dice 60.
 */
export const DIAS_DE_RETENCION = 90;

export type ResultadoPurga = {
  /** Cuántas filas se purgaron en esta corrida, contadas con RETURNING. */
  purgadas: number;
  /** Cuántas quedan con contenido y todavía dentro del plazo. */
  vivas: number;
  /** Cuántas ya estaban purgadas antes de esta corrida. */
  yaPurgadas: number;
  /** La fila con contenido más vieja que queda, para ver que el plazo se respeta. */
  masViejaViva: string | null;
};

/**
 * Purga el contenido de lo que pasó el plazo. Idempotente: la segunda corrida seguida
 * devuelve purgadas: 0, porque el WHERE exige purgado_en IS NULL y la primera ya lo escribió.
 *
 * LA GUARDA ES purgado_en IS NULL Y NO UNA FECHA, y la diferencia importa: filtrar por
 * "creado_en < hoy - 90" sin mirar purgado_en volvería a tocar en cada corrida las mismas
 * filas ya vacías, y el conteo de "purgadas" mentiría para siempre. Con la guarda, cada fila
 * se purga UNA vez y el número dice algo.
 *
 * Y NO es el patrón prohibido de "la guarda es un valor que la propia migración escribe":
 * eso es malo cuando el valor también lo escribe el código normal, porque entonces filas
 * nuevas vuelven a matchear. purgado_en lo escribe SOLO esta función, nada más lo pone, así
 * que una vez consumido no se recrea.
 */
export async function purgarMailOutbox(
  sql: (strings: TemplateStringsArray, ...valores: unknown[]) => Promise<Record<string, unknown>[]>,
  opciones: { dryRun?: boolean } = {}
): Promise<ResultadoPurga> {
  const dias = DIAS_DE_RETENCION;

  const [yaEstaban] = await sql`
    SELECT COUNT(*)::int AS n FROM mail_outbox WHERE purgado_en IS NOT NULL
  `;

  /** Las que CORRESPONDE purgar, contadas antes de tocarlas para que el dryRun diga lo mismo
   *  que haría la corrida real. */
  const [aPurgar] = await sql`
    SELECT COUNT(*)::int AS n FROM mail_outbox
    WHERE purgado_en IS NULL AND creado_en < now() - (${dias} || ' days')::interval
  `;

  let purgadas = 0;
  if (!opciones.dryRun && (aPurgar.n as number) > 0) {
    /**
     * Las tres columnas en UNA sentencia, que es lo que el CHECK exige: purgado_en no puede
     * quedar escrito con el cuerpo todavía ahí. No hace falta transacción porque es una sola
     * sentencia — si fueran dos UPDATE, entre uno y otro la fila violaría el CHECK y el
     * segundo fallaría con la purga a medias.
     */
    const filas = await sql`
      UPDATE mail_outbox
      SET asunto = NULL, cuerpo = NULL, purgado_en = now()
      WHERE purgado_en IS NULL AND creado_en < now() - (${dias} || ' days')::interval
      RETURNING id
    `;
    purgadas = filas.length;
  }

  const [vivas] = await sql`
    SELECT COUNT(*)::int AS n FROM mail_outbox WHERE purgado_en IS NULL
  `;
  const [masVieja] = await sql`
    SELECT creado_en FROM mail_outbox WHERE purgado_en IS NULL ORDER BY creado_en ASC LIMIT 1
  `;

  return {
    purgadas: opciones.dryRun ? (aPurgar.n as number) : purgadas,
    vivas: vivas.n as number,
    yaPurgadas: yaEstaban.n as number,
    masViejaViva: masVieja?.creado_en ? new Date(masVieja.creado_en as string).toISOString() : null,
  };
}
