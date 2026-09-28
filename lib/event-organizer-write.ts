/**
 * ASIGNARLE UN ORGANIZADOR A UN EVENTO, DESDE MODERACIÓN.
 *
 * ============================================================
 * POR QUÉ HACE FALTA UN CAMINO APARTE
 * ============================================================
 *
 * updateCommunityEvent no sirve para esto, y no es un descuido suyo: pide
 * canEditCollective SOBRE EL ORGANIZADOR ACTUAL. Cuando no hay organizador no hay
 * nada contra lo que preguntar, así que el evento queda fuera del alcance de todo
 * el mundo — la única persona que podría arreglarlo es la que no existe todavía.
 *
 * Los eventos sin organizador son reales y son los viejos: los que entraron antes
 * de §7, cuando un evento no tenía a nombre de quién estar. En dev son los 4 que
 * hay. No están roto nada, pero mientras no tengan dueño nadie puede corregirles
 * la fecha, y su lineup no le suma convocatoria a ningún colectivo.
 *
 * ============================================================
 * ES MODERACIÓN, ASÍ QUE PIDE ADMIN Y NO PERMISOS DE COLECTIVO
 * ============================================================
 *
 * No entra por canEditCollective ni por puedeAdministrarColectivo: nadie tiene
 * permiso sobre un evento huérfano, y la pregunta "¿podés editar este colectivo?"
 * no es la que hay que hacer. La que hay que hacer es "¿sos moderador?".
 *
 * Y NO se le ofrece al colectivo reclamar un evento por su cuenta. Sería el mismo
 * agujero que la fase 2 cerró con las residencias: quien se auto-asigna un evento
 * se queda con su lineup, sus números de convocatoria y el derecho a editarlo.
 * Eso lo decide una persona, no el que lo pide.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import type { WriteResult } from "./collectives-gate";
import { resolverRolParaRegistro, sentenciaDeRegistro } from "./edit-log-write";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Le pone organizador a un evento, o se lo saca.
 *
 * `collectiveSlug` en null DESAMPARA el evento a propósito: es la única forma de
 * revertir una asignación equivocada, y una asignación equivocada le está dando
 * la convocatoria de una fiesta al colectivo que no la hizo. Sin vuelta atrás,
 * el error queda para siempre en los números de alguien.
 */
export async function asignarOrganizador(
  eventId: number,
  collectiveSlug: string | null,
  actorEmail: string
): Promise<WriteResult<{ antes: string | null; ahora: string | null }>> {
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return { ok: false, status: 404, error: "No encontré ese evento" };
  }

  const [evento] = await sql`SELECT id, organizer_slug FROM events WHERE id = ${eventId}`;
  if (!evento) return { ok: false, status: 404, error: "No encontré ese evento" };
  const antes = (evento.organizer_slug as string | null) ?? null;

  if (collectiveSlug !== null) {
    /**
     * TIENE QUE EXISTIR Y NO PUEDE ESTAR CENSURADO.
     *
     * Lo de la censura no es celo: asignarle un evento a un perfil bajado por
     * moderación lo publica de rebote —el evento sale con su nombre y linkea a
     * su página— y eso deshace la censura por un costado, sin que nadie la haya
     * levantado.
     */
    const [org] = await sql`
      SELECT slug, entity_kind, censored_at FROM collectives WHERE slug = ${collectiveSlug}`;
    if (!org) {
      return { ok: false, status: 404, error: `No existe el colectivo "${collectiveSlug}"` };
    }
    if (org.censored_at) {
      return {
        ok: false,
        status: 409,
        error:
          "Ese perfil está bajado por moderación. Asignarle un evento lo publicaría de vuelta " +
          "por el costado: primero se levanta la censura.",
      };
    }
    /**
     * UN VENUE SÍ PUEDE ORGANIZAR, y esto es distinto del lineup.
     *
     * En un lineup un venue no toca —eso lo rechaza el otro endpoint— pero un
     * venue SÍ produce sus propias fiestas, y events.organizer_slug ya admite
     * venues desde §7: el formulario de publicar se los ofrece. Queda dicho
     * porque la regla del lineup invita a repetirla acá, y acá sería errónea.
     */
  }

  if (antes === collectiveSlug) {
    return { ok: true, value: { antes, ahora: collectiveSlug } };
  }

  /**
   * SE REGISTRA CONTRA LOS DOS COLECTIVOS CUANDO HAY DOS.
   *
   * Un cambio de organizador es una edición para el que lo recibe y también para
   * el que lo pierde: su press kit cambia. Registrar solo el destino dejaría al
   * colectivo despojado sin ninguna huella de por qué le bajó la convocatoria.
   *
   * LOS DOS ROLES SE RESUELVEN ANTES DE ESCRIBIR, y si cualquiera de los dos no
   * se puede, no se mueve nada. Media auditoría sería peor que ninguna: diría que
   * el evento llegó a un colectivo sin decir de dónde salió.
   */
  const pasos: ReturnType<typeof sentenciaDeRegistro>[] = [];

  for (const [slug, accion] of [
    ...(antes ? ([[antes, "borrar"]] as const) : []),
    ...(collectiveSlug ? ([[collectiveSlug, antes ? "editar" : "crear"]] as const) : []),
  ]) {
    const rol = await resolverRolParaRegistro(slug, actorEmail);
    if (!rol) {
      return {
        ok: false,
        status: 403,
        error:
          `No pude determinar con qué rol registrar este cambio sobre ${slug}, así que no lo ` +
          "apliqué. Nada se escribe sin registro.",
      };
    }
    pasos.push(
      sentenciaDeRegistro(rol, {
        collectiveSlug: slug,
        actorEmail,
        entidad: "event",
        entidadId: String(eventId),
        accion,
        campos: ["organizer_slug"],
      })
    );
  }

  await sql.transaction([
    sql`UPDATE events SET organizer_slug = ${collectiveSlug} WHERE id = ${eventId}`,
    ...pasos,
  ]);

  return { ok: true, value: { antes, ahora: collectiveSlug } };
}

export type EventoSinOrganizador = {
  id: number;
  title: string;
  date: string;
  venue: string;
  city: string;
  lineup: string;
};

/**
 * LA COLA: los eventos sin organizador, los más nuevos primero.
 *
 * Es su propia cola y NO la de /admin/lineups, que lista los de lineup sin
 * revisar. Son dos conjuntos distintos con dos criterios distintos, y meter esto
 * ahí dejaría inalcanzable un evento sin organizador cuyo lineup ya se revisó.
 * Hoy en dev ese conjunto está vacío —los 4 sin organizador tampoco están
 * revisados— pero depender de que siga coincidiendo es depender de una
 * casualidad.
 */
export async function eventosSinOrganizador(): Promise<EventoSinOrganizador[]> {
  const rows = await sql`
    SELECT id, title, event_date::text AS d, venue, city, lineup
    FROM events
    WHERE organizer_slug IS NULL
    ORDER BY event_date DESC, id DESC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title as string,
    date: r.d as string,
    venue: r.venue as string,
    city: r.city as string,
    lineup: (r.lineup as string) ?? "",
  }));
}
