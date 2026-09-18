"use server";

import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

const sql = neon(process.env.DATABASE_URL!);

/**
 * El distrito congelado que llevan los eventos nuevos (tanda 4 §3).
 *
 * events.district es NOT NULL y NO tiene DEFAULT, así que omitirlo del
 * INSERT revienta. Ponerle un DEFAULT a una columna que se va a borrar
 * es trabajo para deshacer después, y esta tanda no lleva migración.
 *
 * news y collectives SÍ tienen DEFAULT 'D00', pero igual lo escriben
 * explícito. Apoyarse en el default obligaría a verificar que main tenga
 * exactamente el mismo schema que dev antes de cada despliegue, y no
 * tengo forma de consultar main desde acá. Escribir el valor no depende
 * del schema: si el default está, es idéntico; si no está, es lo único
 * que evita un not-null en producción.
 *
 * Los UPDATE directamente dejan de tocar la columna: lo que ya está
 * guardado se queda como está, congelado, hasta que se borre.
 */
const DISTRITO_CONGELADO = "D00";

function refreshAll() {
  revalidatePath("/", "layout");
}

/**
 * Uploads the "flyer" file field to Vercel Blob if one was actually
 * chosen, returning its public URL. Returns undefined if the field was
 * left empty, so callers can tell "no new file" apart from "clear it" —
 * useful on update, where an empty file input should leave the existing
 * flyer alone rather than wiping it.
 */
async function uploadFlyerIfPresent(formData: FormData): Promise<string | undefined> {
  const file = formData.get("flyer");
  if (!(file instanceof File) || file.size === 0) return undefined;
  const blob = await put(`flyers/${Date.now()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });
  return blob.url;
}

/** Normalises a <input type="datetime-local"> value ("2026-08-27T05:00")
 * to an ISO timestamp, or null if the field was left empty. */
function readEndAt(formData: FormData): string | null {
  const raw = String(formData.get("endAt") ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Reads the shared editorial fields out of a form submission. */
function readMeta(formData: FormData) {
  const scope = String(formData.get("scope") ?? "country");
  const countryCode = scope === "global" ? "" : String(formData.get("countryCode") ?? "COL");
  const language = String(formData.get("language") ?? "es");
  const status = String(formData.get("status") ?? "published");
  const featured = formData.get("featured") === "on";
  // While featured, priority_at carries a timestamp so it can be ranked
  // against other featured items; the moment it's unfeatured, priority_at
  // goes back to null and normal date ordering takes over automatically.
  const priorityAt = featured ? new Date().toISOString() : null;
  return { scope, countryCode, language, status, featured, priorityAt };
}

/**
 * El organizador del evento (§7). Vacío significa NULL, no "".
 *
 * organizer_slug es un FK contra collectives(slug): una cadena vacía no
 * corresponde a ninguna fila y reventaría con foreign_key_violation. Un
 * evento sin organizador es un estado legítimo —hoy lo son todos— y se
 * representa con NULL.
 */
function readOrganizer(formData: FormData): string | null {
  const v = formData.get("organizerSlug");
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

export async function createEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  const endAt = readEndAt(formData);
  const flyerUrl = (await uploadFlyerIfPresent(formData)) ?? null;
  await sql`
    INSERT INTO events (event_date, end_at, flyer_url, city, venue, title, lineup, organizer_slug, district, scope, country_code, language, status, featured, priority_at)
    VALUES (${String(formData.get("date"))}, ${endAt}, ${flyerUrl}, ${String(formData.get("city"))}, ${String(formData.get("venue"))}, ${String(formData.get("title"))}, ${String(formData.get("lineup"))}, ${readOrganizer(formData)}, ${DISTRITO_CONGELADO}, ${m.scope}, ${m.countryCode}, ${m.language}, ${m.status}, ${m.featured}, ${m.priorityAt})
  `;
  refreshAll();
}

export async function updateEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  const endAt = readEndAt(formData);
  // Undefined means "no new file chosen" — keep whatever flyer_url is
  // already there instead of overwriting it with null.
  const newFlyerUrl = await uploadFlyerIfPresent(formData);
  if (newFlyerUrl !== undefined) {
    await sql`
      UPDATE events SET
        event_date = ${String(formData.get("date"))},
        end_at = ${endAt},
        flyer_url = ${newFlyerUrl},
        city = ${String(formData.get("city"))},
        venue = ${String(formData.get("venue"))},
        title = ${String(formData.get("title"))},
        lineup = ${String(formData.get("lineup"))},
        organizer_slug = ${readOrganizer(formData)},
        scope = ${m.scope},
        country_code = ${m.countryCode},
        language = ${m.language},
        status = ${m.status},
        featured = ${m.featured},
        priority_at = ${m.priorityAt}
      WHERE id = ${Number(formData.get("id"))}
    `;
  } else {
    await sql`
      UPDATE events SET
        event_date = ${String(formData.get("date"))},
        end_at = ${endAt},
        city = ${String(formData.get("city"))},
        venue = ${String(formData.get("venue"))},
        title = ${String(formData.get("title"))},
        lineup = ${String(formData.get("lineup"))},
        organizer_slug = ${readOrganizer(formData)},
        scope = ${m.scope},
        country_code = ${m.countryCode},
        language = ${m.language},
        status = ${m.status},
        featured = ${m.featured},
        priority_at = ${m.priorityAt}
      WHERE id = ${Number(formData.get("id"))}
    `;
  }
  refreshAll();
}

export async function deleteEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`DELETE FROM events WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}

export async function createNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  await sql`
    INSERT INTO news (tag, news_date, title, excerpt, district, scope, country_code, language, status, featured, priority_at)
    VALUES (${String(formData.get("tag"))}, ${String(formData.get("date"))}, ${String(formData.get("title"))}, ${String(formData.get("excerpt"))}, ${DISTRITO_CONGELADO}, ${m.scope}, ${m.countryCode}, ${m.language}, ${m.status}, ${m.featured}, ${m.priorityAt})
  `;
  refreshAll();
}

export async function updateNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  await sql`
    UPDATE news SET
      tag = ${String(formData.get("tag"))},
      news_date = ${String(formData.get("date"))},
      title = ${String(formData.get("title"))},
      excerpt = ${String(formData.get("excerpt"))},
      scope = ${m.scope},
      country_code = ${m.countryCode},
      language = ${m.language},
      status = ${m.status},
      featured = ${m.featured},
      priority_at = ${m.priorityAt}
    WHERE id = ${Number(formData.get("id"))}
  `;
  refreshAll();
}

export async function deleteNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`DELETE FROM news WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}

/**
 * collectives.artist_slugs is NO LONGER WRITTEN here.
 *
 * Membership lives in artist_collectives, where a link carries a kind
 * (casa / residente) and a date range — neither of which a
 * comma-separated list of slugs can express, and the kind is what sales
 * attribution rests on. Members are managed through
 * /api/collectives/[slug]/members.
 *
 * The column itself is left in place as a fallback until the migration has
 * been running for a while; it is simply frozen at whatever it last held.
 */
export async function createCollective(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  await sql`
    INSERT INTO collectives (slug, name, type, sector, bio, district, scope, country_code, language, status, featured, priority_at)
    VALUES (${String(formData.get("slug"))}, ${String(formData.get("name"))}, ${String(formData.get("type"))}, ${String(formData.get("sector"))}, ${String(formData.get("bio"))}, ${DISTRITO_CONGELADO}, ${m.scope}, ${m.countryCode}, ${m.language}, ${m.status}, ${m.featured}, ${m.priorityAt})
  `;
  refreshAll();
}

export async function updateCollective(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  await sql`
    UPDATE collectives SET
      name = ${String(formData.get("name"))},
      type = ${String(formData.get("type"))},
      sector = ${String(formData.get("sector"))},
      bio = ${String(formData.get("bio"))},
      scope = ${m.scope},
      country_code = ${m.countryCode},
      language = ${m.language},
      status = ${m.status},
      featured = ${m.featured},
      priority_at = ${m.priorityAt}
    WHERE slug = ${String(formData.get("originalSlug"))}
  `;
  refreshAll();
}

/**
 * Borra un colectivo desde el panel de admin.
 *
 * Acotado a entity_kind='collective' a propósito. Colectivos y venues
 * comparten tabla, y el panel de colectivos lista colectivos: sin este
 * filtro, borrar "un colectivo" de esa lista podría borrar un venue, y
 * se llevaría en cascada sus géneros y sus vínculos. Los venues se
 * borran desde su propio panel o no se borran.
 */
/**
 * Borra un colectivo, Y SE NIEGA SI TIENE CONTENIDO PUBLICADO.
 *
 * content_placements.collective_slug va ON DELETE CASCADE, así que sin
 * esta guarda borrar el colectivo se llevaba los placements y dejaba
 * cada pieza fija sin destino: invisible en todas partes —no entra por
 * el camino vivo porque is_fixed la excluye, ni por el fijo porque ya no
 * tiene filas—, sin error, para siempre. Un botón de admin que rompe
 * datos con un click no es deuda futura.
 *
 * SE NIEGA, NO REASIGNA. Reasignar obligaría al código a elegir un
 * destino que nadie pidió, y eso es inventar una decisión del DJ. Si un
 * colectivo tiene contenido publicado, alguien tiene que decidir qué
 * pasa con ese contenido ANTES de borrarlo.
 *
 * Y el mensaje dice CUÁLES, no solo cuántas. Un "no se puede, tiene 12
 * piezas" manda al admin a buscarlas a mano, que es el trabajo que la
 * guarda tendría que estar ahorrando.
 *
 * Solo cuenta lo FIJO. El contenido vivo no tiene filas en
 * content_placements —vive en la casa actual de su autor y se deriva—,
 * así que borrar el colectivo simplemente lo deja sin aparecer ahí, que
 * es lo correcto: el colectivo dejó de existir. Lo que no puede pasar es
 * que una pieza congelada pierda el único destino que tenía.
 */
export async function deleteCollective(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const slug = String(formData.get("slug"));

  // Los eventos que organiza. VAN EN LA MISMA NEGATIVA, y tienen que ir
  // ahora y no después: events.organizer_slug es ON DELETE RESTRICT, así
  // que sin esta guarda Postgres devuelve un foreign_key_violation crudo
  // desde un Server Action — en producción eso es una pantalla rota con
  // un digest, sin decirle al admin que el motivo es "organiza eventos".
  const eventos = await sql`
    SELECT id, title FROM events WHERE organizer_slug = ${slug} ORDER BY event_date DESC
  `;

  const piezas = await sql`
    SELECT 'set' AS tipo, set_slug AS pieza FROM content_placements
      WHERE collective_slug = ${slug} AND set_slug IS NOT NULL
    UNION ALL
    SELECT 'track', track_slug FROM content_placements
      WHERE collective_slug = ${slug} AND track_slug IS NOT NULL
    ORDER BY 1, 2
  `;

  if (eventos.length > 0) {
    throw new Error(
      `No se puede borrar "${slug}": organiza ${eventos.length} evento(s) — ` +
        eventos.map((e) => `#${e.id} ${e.title}`).join(", ") +
        ". Reasignales otro organizador antes de borrarlo. No se hace solo: " +
        "elegir a quién pasan esos eventos es una decisión, no un default."
    );
  }

  if (piezas.length > 0) {
    const sets = piezas.filter((r) => r.tipo === "set").map((r) => r.pieza as string);
    const tracks = piezas.filter((r) => r.tipo === "track").map((r) => r.pieza as string);
    const partes = [
      sets.length > 0 ? `${sets.length} set(s): ${sets.join(", ")}` : null,
      tracks.length > 0 ? `${tracks.length} track(s): ${tracks.join(", ")}` : null,
    ].filter(Boolean);
    throw new Error(
      `No se puede borrar "${slug}": tiene contenido publicado que quedaría sin destino. ` +
        partes.join(" · ") +
        ". Cada pieza está fija acá porque se publicó con colaboradores, y lo fijo no migra: " +
        "hay que decidir qué pasa con ese contenido antes de borrar el colectivo."
    );
  }

  await sql`
    DELETE FROM collectives
    WHERE slug = ${slug} AND entity_kind = 'collective'
  `;
  refreshAll();
}
