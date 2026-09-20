/**
 * Publicar un evento desde una cuenta de la comunidad (tanda 5 §3).
 *
 * Hasta hoy los eventos solo nacían del admin, por Server Action, porque
 * no había otro camino. Este es el otro camino: lo publica el dueño del
 * colectivo o del venue que lo organiza, desde su panel.
 *
 * NO HAY COLA DE APROBACIÓN ACÁ, y es a propósito. La migración de este
 * paso le puso revisión a las NOTICIAS y no a los eventos: una fiesta
 * tiene fecha, y una cola de aprobación entre el anuncio y la puerta
 * convierte al admin en el cuello de botella de la agenda de la escena.
 * Un evento sale publicado y el admin lo censura si hace falta, que es
 * exactamente el rol que esta tanda le deja.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { isOwnBlobUrl } from "./blob";
import { canEditCollective, type WriteResult } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

/**
 * El distrito congelado, igual que en lib/db-write.ts.
 *
 * events.district es NOT NULL y NO tiene DEFAULT, así que omitirlo del
 * INSERT revienta. El sistema de distritos se está yendo y ponerle un
 * DEFAULT a una columna que se va a borrar es trabajo para deshacer.
 */
const DISTRITO_CONGELADO = "D00";

export type NuevoEvento = {
  /** El colectivo o venue que organiza. Decide también quién puede. */
  organizerSlug?: unknown;
  title?: unknown;
  /** YYYY-MM-DD. events.event_date es DATE: no lleva hora. */
  date?: unknown;
  /** Valor de un <input type="datetime-local">, o vacío. */
  endAt?: unknown;
  venue?: unknown;
  city?: unknown;
  lineup?: unknown;
  /** URL que devolvió /api/upload. */
  flyerUrl?: unknown;
};

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Publica un evento a nombre de un colectivo o de un venue.
 *
 * Lo único que el cliente decide sobre permisos es a nombre de QUIÉN
 * publica; si puede o no lo resuelve canEditCollective contra la sesión,
 * que es la misma función que usan el panel y el editor de miembros.
 */
export async function createCommunityEvent(
  input: NuevoEvento,
  email?: string | null
): Promise<WriteResult<{ id: number; slugOrganizador: string }>> {
  if (!email) return { ok: false, status: 403, error: "Not signed in" };

  const organizerSlug = texto(input.organizerSlug);
  if (!organizerSlug) {
    return { ok: false, status: 400, error: "Decí a nombre de quién lo publicás" };
  }

  const [org] = await sql`
    SELECT slug, name, sector, entity_kind FROM collectives WHERE slug = ${organizerSlug}
  `;
  if (!org) return { ok: false, status: 404, error: "Ese colectivo no existe" };

  if (!(await canEditCollective(organizerSlug, email))) {
    return {
      ok: false,
      status: 403,
      error: "Solo quien administra ese colectivo publica a su nombre",
    };
  }

  const title = texto(input.title);
  if (title.length < 3) {
    return { ok: false, status: 400, error: "El evento necesita un nombre de al menos 3 letras" };
  }

  // La fecha se valida en DOS pasos y los dos hacen falta. El formato
  // solo dice que tiene la forma; re-serializar la fecha parseada es lo
  // que descarta un 2026-02-31, que pasa el regex y Postgres rechaza
  // después con un date/time field value out of range — un 500 crudo en
  // vez de un mensaje.
  const date = texto(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, status: 400, error: "La fecha tiene que ser AAAA-MM-DD" };
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { ok: false, status: 400, error: `No existe la fecha ${date}` };
  }

  /**
   * end_at opcional. Mismo tratamiento que el admin: llega el valor
   * crudo de un datetime-local y se normaliza a ISO.
   *
   * La comparación es por DÍA, no por instante, y no puede ser de otra
   * forma: event_date es un DATE, así que el evento no tiene hora de
   * inicio contra la cual comparar. Lo único que se puede afirmar es que
   * un evento no termina ANTES del día en que pasa.
   */
  const endRaw = texto(input.endAt);
  let endAt: string | null = null;
  if (endRaw) {
    const d = new Date(endRaw);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, status: 400, error: "La hora de cierre no se entiende" };
    }
    if (d.toISOString().slice(0, 10) < date) {
      return {
        ok: false,
        status: 400,
        error: "La hora de cierre cae antes del día del evento",
      };
    }
    endAt = d.toISOString();
  }

  /**
   * EL VENUE SE DERIVA CUANDO QUIEN PUBLICA **ES** EL VENUE.
   *
   * events.venue es NOT NULL y es el lugar donde pasa la fiesta. Si el
   * que publica es un venue, ese lugar es él: pedirle que lo teclee es
   * pedirle que repita su propio nombre, y lo va a escribir distinto de
   * como está en su página la mitad de las veces.
   *
   * Un colectivo sí tiene que decirlo: toca en lugares distintos.
   */
  const esVenue = (org.entity_kind as string) === "venue";
  const venue = texto(input.venue) || (esVenue ? String(org.name) : "");
  if (!venue) {
    return { ok: false, status: 400, error: "Decí en qué lugar es" };
  }

  // La ciudad cae al sector del colectivo, que es donde createCollective
  // sembró la del fundador. Es un dato que el que publica ya dio una vez.
  const city = texto(input.city) || texto(org.sector);
  if (!city) {
    return { ok: false, status: 400, error: "Decí en qué ciudad es" };
  }

  // lineup es NOT NULL y hoy es texto libre: el importador de
  // event_lineup lo resuelve después contra artistas y colectivos.
  const lineup = texto(input.lineup).slice(0, 2000);

  /**
   * El flyer TIENE QUE SER UNO NUESTRO.
   *
   * isOwnBlobUrl es la misma guarda que usa el borrado de imágenes del
   * EPK. Sin ella, flyerUrl es un campo donde cualquiera con una cuenta
   * pega la URL que quiera y HOTU la sirve desde su propia página: un
   * host ajeno que mide quién abre la agenda, o que cambia la imagen por
   * otra cosa después de que un moderador la miró.
   */
  const flyerRaw = texto(input.flyerUrl);
  if (flyerRaw && !isOwnBlobUrl(flyerRaw)) {
    return {
      ok: false,
      status: 400,
      error: "El flyer tiene que subirse acá, no enlazarse de otro lado",
    };
  }
  const flyerUrl = flyerRaw || null;

  const [fila] = await sql`
    INSERT INTO events
      (event_date, end_at, flyer_url, city, venue, title, lineup, organizer_slug,
       district, scope, country_code, language, status, featured, priority_at)
    VALUES
      (${date}, ${endAt}, ${flyerUrl}, ${city.slice(0, 120)}, ${venue.slice(0, 160)},
       ${title.slice(0, 160)}, ${lineup}, ${organizerSlug},
       ${DISTRITO_CONGELADO}, 'country', 'COL', 'es', 'published', false, NULL)
    RETURNING id
  `;

  return { ok: true, value: { id: Number(fila.id), slugOrganizador: organizerSlug } };
}
