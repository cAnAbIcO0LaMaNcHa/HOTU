/**
 * LO QUE SE LEE DE UNA CONVOCATORIA. Node-only.
 *
 * Tres lectores, uno por pantalla:
 *
 *   getConvocatoriasAbiertas()      — la vitrina: a qué se puede postular un DJ hoy.
 *   getConvocatoriaDeEvento(id)     — el panel del dueño: su convocatoria y quién se anotó.
 *   getPostulacionesDeArtista(slug) — la bandeja del DJ: en qué quedó cada una.
 *
 * ============================================================
 * "ABIERTA" SE DERIVA EN EL WHERE, SIEMPRE
 * ============================================================
 *
 * Los tres usan CONVOCATORIA_ABIERTA de lib/convocatorias.ts, la MISMA expresión que el write
 * path. Esa es toda la razón de que exista como constante: si un lector la escribiera por su
 * cuenta y se le olvidara la parte del evento pasado, mostraría convocatorias a las que el
 * write path se niega a aceptar postulaciones. El DJ vería el botón, lo apretaría, y recibiría
 * un 409 sin entender por qué.
 *
 * ============================================================
 * LA BANDEJA DEL DJ MUESTRA EL HISTÓRICO, NO SOLO LO ABIERTO
 * ============================================================
 *
 * getPostulacionesDeArtista NO filtra por convocatoria abierta, y es lo contrario de los otros
 * dos. Lo que el DJ necesita ver es en qué quedó cada cosa: aceptada, rechazada, retirada o
 * cancelada, con su motivo cuando hay. Filtrar por abierta le escondería justamente las
 * resueltas, que son las que tienen una respuesta.
 */

import { neon } from "@neondatabase/serverless";
import { CONVOCATORIA_ABIERTA } from "./convocatorias";
import { toISODate } from "./date-utils";

const sql = neon(process.env.DATABASE_URL!);

/**
 * NO LLEVA DISTRITO, NI DEL EVENTO NI DEL ARTISTA. El sistema de diez distritos con color se
 * borró, y medido con grep NO QUEDA UN SOLO COMPONENTE que lea .district para pintar nada. Las
 * columnas siguen ahí y siguen siendo NOT NULL, que es la trampa: traerlas compila y devuelve
 * un valor que en pantalla no dice nada. Lo que identifica un perfil ahora es el género.
 */
export type ConvocatoriaAbierta = {
  id: number;
  eventId: number;
  eventTitle: string;
  eventDate: string;
  venue: string;
  city: string;
  flyerUrl: string | null;
  collectiveSlug: string;
  collectiveName: string;
  cupos: number | null;
  /** El instante de cierre en ISO, o null si no tiene fecha de cierre. */
  cierraEn: string | null;
  nota: string | null;
  /** Cuántos ya se anotaron. Público a propósito: un DJ decide con eso si vale la pena. */
  postulaciones: number;
};

/**
 * Las convocatorias a las que se puede postular hoy.
 *
 * Solo de eventos PUBLICADOS y sin censurar: una convocatoria de un evento que el visitante no
 * puede ver sería un link a nada. Es el mismo filtro que usan /eventos y el resto del sitio.
 */
/**
 * LA VITRINA FILTRA POR VISIBILIDAD, Y EL PARÁMETRO NO ES OPCIONAL A PROPÓSITO.
 *
 * `esDj` dice si quien mira tiene perfil de artista. Con false solo se devuelven las
 * 'publica'; con true, todas.
 *
 * NO TIENE DEFAULT. Un `esDj = false` por defecto escondería convocatorias a un DJ que las
 * puede ver —malo pero visible—, y un `true` por defecto las mostraría a cualquiera, que es
 * exactamente la decisión que esta columna existe para no tomar por el colectivo. Obligar al
 * llamador a decirlo hace que la pregunta no se pueda olvidar.
 *
 * Y ES UN FILTRO DE PRESENTACIÓN, NO UN PERMISO: el write path no mira visibilidad, así que
 * una 'djs' sigue siendo postulable. Está medido en la batería.
 */
export async function getConvocatoriasAbiertas(esDj: boolean): Promise<ConvocatoriaAbierta[]> {
  const filas = await sql(
    `SELECT ec.id, ec.event_id, ec.cupos, ec.cierra_en, ec.nota, ec.collective_slug,
            e.title, e.event_date, e.venue, e.city, e.flyer_url,
            c.name AS collective_name,
            (SELECT COUNT(*)::int FROM event_applications ea WHERE ea.call_id = ec.id) AS postulaciones
     FROM event_calls ec
     JOIN events e ON e.id = ec.event_id
     JOIN collectives c ON c.slug = ec.collective_slug
     WHERE ${CONVOCATORIA_ABIERTA}
       AND e.status = 'published' AND e.censored_at IS NULL
       AND ($1 OR ec.visibilidad = 'publica')
     ORDER BY e.event_date ASC, ec.id ASC`,
    [esDj]
  );
  return filas.map((r) => ({
    id: r.id as number,
    eventId: r.event_id as number,
    eventTitle: r.title as string,
    eventDate: toISODate(r.event_date),
    venue: r.venue as string,
    city: r.city as string,
    flyerUrl: (r.flyer_url as string | null) ?? null,
    collectiveSlug: r.collective_slug as string,
    collectiveName: r.collective_name as string,
    cupos: (r.cupos as number | null) ?? null,
    cierraEn: r.cierra_en ? new Date(r.cierra_en as string).toISOString() : null,
    nota: (r.nota as string | null) ?? null,
    postulaciones: r.postulaciones as number,
  }));
}

export type PostulacionEnPanel = {
  id: number;
  artistSlug: string;
  artistName: string;
  artistPhoto: string | null;
  /**
   * EL GÉNERO Y NO EL DISTRITO. La primera versión traía artistDistrict porque el sistema de
   * diez distritos con color era cómo se identificaba un perfil de un vistazo. ESE SISTEMA SE
   * BORRÓ: no queda una sola línea de color por distrito en el código —medido con grep— así que
   * el distrito dejó de decirle algo a quien mira. El género sí.
   *
   * La columna artists.district sigue existiendo y sigue siendo NOT NULL, lo cual es justamente
   * la trampa: traerla compila, devuelve un valor, y no significa nada en pantalla.
   */
  artistGenre: string;
  mensaje: string;
  disponibilidad: string;
  creadaEn: string;
  /** null = pendiente. */
  resultado: "aceptada" | "rechazada" | "retirada" | "cancelada" | null;
  resueltaEn: string | null;
  motivo: string | null;
};

export type ConvocatoriaDeEvento = {
  id: number;
  collectiveSlug: string;
  cupos: number | null;
  cierraEn: string | null;
  nota: string | null;
  /** Si está abierta DE HECHO, derivado. Puede ser false con cerrada_en en NULL. */
  abierta: boolean;
  cerradaEn: string | null;
  /** NULL con cerradaEn puesta = la cerró el barrido, no una persona. */
  cerradaPor: string | null;
  /** Quién ve el distintivo en /eventos. 'djs' = solo quien tiene perfil de artista. */
  visibilidad: "djs" | "publica";
  postulaciones: PostulacionEnPanel[];
};

/**
 * La convocatoria de un evento, con sus postulaciones, para el panel del dueño.
 *
 * Devuelve la ÚLTIMA, abierta o cerrada, porque el panel tiene que poder mostrar el histórico
 * después de cerrarla. Un evento puede tener varias cerradas y una sola abierta.
 *
 * `abierta` se deriva acá y no se lee de cerrada_en: una convocatoria a la que se le pasó
 * cierra_en está cerrada de hecho aunque el barrido todavía no haya corrido, y el panel tiene
 * que mostrar eso y no un botón de cerrar que ya no significa nada.
 */
export async function getConvocatoriaDeEvento(
  eventId: number
): Promise<ConvocatoriaDeEvento | null> {
  const [call] = await sql(
    `SELECT ec.id, ec.collective_slug, ec.cupos, ec.cierra_en, ec.nota,
            ec.cerrada_en, ec.cerrada_por, ec.visibilidad,
            (${CONVOCATORIA_ABIERTA}) AS abierta
     FROM event_calls ec
     JOIN events e ON e.id = ec.event_id
     WHERE ec.event_id = $1
     ORDER BY ec.cerrada_en IS NULL DESC, ec.creada_en DESC
     LIMIT 1`,
    [eventId]
  );
  if (!call) return null;

  const filas = await sql`
    SELECT ea.id, ea.artist_slug, ea.mensaje, ea.disponibilidad, ea.creada_en,
           ea.resultado, ea.resuelta_en, ea.motivo,
           ar.name, ar.photo, ar.genre
    FROM event_applications ea
    JOIN artists ar ON ar.slug = ea.artist_slug
    WHERE ea.call_id = ${call.id}
    ORDER BY ea.resuelta_en IS NULL DESC, ea.creada_en ASC`;

  return {
    id: call.id as number,
    collectiveSlug: call.collective_slug as string,
    cupos: (call.cupos as number | null) ?? null,
    cierraEn: call.cierra_en ? new Date(call.cierra_en as string).toISOString() : null,
    nota: (call.nota as string | null) ?? null,
    abierta: Boolean(call.abierta),
    cerradaEn: call.cerrada_en ? new Date(call.cerrada_en as string).toISOString() : null,
    cerradaPor: (call.cerrada_por as string | null) ?? null,
    visibilidad: call.visibilidad as "djs" | "publica",
    postulaciones: filas.map((r) => ({
      id: r.id as number,
      artistSlug: r.artist_slug as string,
      artistName: r.name as string,
      artistPhoto: (r.photo as string | null) ?? null,
      artistGenre: r.genre as string,
      mensaje: r.mensaje as string,
      disponibilidad: r.disponibilidad as string,
      creadaEn: new Date(r.creada_en as string).toISOString(),
      resultado: (r.resultado as PostulacionEnPanel["resultado"]) ?? null,
      resueltaEn: r.resuelta_en ? new Date(r.resuelta_en as string).toISOString() : null,
      motivo: (r.motivo as string | null) ?? null,
    })),
  };
}

export type PostulacionDelArtista = {
  id: number;
  eventId: number;
  eventTitle: string;
  eventDate: string;
  collectiveSlug: string;
  collectiveName: string;
  mensaje: string;
  disponibilidad: string;
  creadaEn: string;
  resultado: PostulacionEnPanel["resultado"];
  resueltaEn: string | null;
  canceladaEn: string | null;
  motivo: string | null;
  /** Si la convocatoria sigue abierta: hasta que no lo esté, el DJ puede retirarse. */
  convocatoriaAbierta: boolean;
};

/** La bandeja del DJ: todas sus postulaciones, de la más nueva a la más vieja. */
export async function getPostulacionesDeArtista(
  artistSlug: string
): Promise<PostulacionDelArtista[]> {
  const filas = await sql(
    `SELECT ea.id, ea.mensaje, ea.disponibilidad, ea.creada_en, ea.resultado,
            ea.resuelta_en, ea.cancelada_en, ea.motivo,
            ec.collective_slug, ec.event_id,
            e.title, e.event_date,
            c.name AS collective_name,
            (${CONVOCATORIA_ABIERTA}) AS abierta
     FROM event_applications ea
     JOIN event_calls ec ON ec.id = ea.call_id
     JOIN events e ON e.id = ec.event_id
     JOIN collectives c ON c.slug = ec.collective_slug
     WHERE ea.artist_slug = $1
     ORDER BY ea.creada_en DESC`,
    [artistSlug]
  );
  return filas.map((r) => ({
    id: r.id as number,
    eventId: r.event_id as number,
    eventTitle: r.title as string,
    eventDate: toISODate(r.event_date),
    collectiveSlug: r.collective_slug as string,
    collectiveName: r.collective_name as string,
    mensaje: r.mensaje as string,
    disponibilidad: r.disponibilidad as string,
    creadaEn: new Date(r.creada_en as string).toISOString(),
    resultado: (r.resultado as PostulacionEnPanel["resultado"]) ?? null,
    resueltaEn: r.resuelta_en ? new Date(r.resuelta_en as string).toISOString() : null,
    canceladaEn: r.cancelada_en ? new Date(r.cancelada_en as string).toISOString() : null,
    motivo: (r.motivo as string | null) ?? null,
    convocatoriaAbierta: Boolean(r.abierta),
  }));
}

/**
 * LO QUE EL DJ YA HIZO, PARA QUE LA LISTA NO LE OFREZCA UNA PUERTA CERRADA.
 *
 * Dos conjuntos en UNA consulta: en qué convocatorias tiene una postulación SIN RESOLVER, y en
 * qué eventos ya está en el lineup con su slug resuelto.
 *
 * ============================================================
 * SE PREGUNTA UNA VEZ PARA TODA LA LISTA
 * ============================================================
 *
 * /eventos pinta hasta decenas de tarjetas. Preguntarlo por tarjeta serían decenas de
 * round-trips del driver HTTP para pintar una lista — el mismo motivo por el que
 * getLineupsByEvent trae todos los lineups de una.
 *
 * ============================================================
 * "YA SE POSTULÓ" ES SOLO LO PENDIENTE, Y ESO ES DELIBERADO
 * ============================================================
 *
 * Una postulación RESUELTA no bloquea nada: si se retiró, o si le cancelaron la participación,
 * se puede volver a postular — el índice único es parcial sobre resuelta_en IS NULL y lo
 * permite. Contar las resueltas acá le escondería el botón a alguien que sí puede usarlo, que
 * es la mitad mala de equivocarse.
 *
 * "YA EN EL LINEUP" mira el slug RESUELTO. Una fila sin resolver con su nombre NO cuenta: esa
 * es una conjetura del importador, no una confirmación, y aceptarlo después la reemplaza.
 */
export async function getLoQueElDjYaHizo(
  artistSlug: string
): Promise<{ pendientesEn: Set<number>; enLineupDe: Set<number> }> {
  const [pend, lin] = await Promise.all([
    sql`
      SELECT call_id FROM event_applications
      WHERE artist_slug = ${artistSlug} AND resuelta_en IS NULL`,
    sql`
      SELECT event_id FROM event_lineup
      WHERE artist_slug = ${artistSlug}`,
  ]);
  return {
    pendientesEn: new Set(pend.map((r) => r.call_id as number)),
    enLineupDe: new Set(lin.map((r) => r.event_id as number)),
  };
}
