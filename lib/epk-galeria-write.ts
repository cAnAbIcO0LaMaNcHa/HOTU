/**
 * Escrituras por fila de las dos secciones nuevas del EPK: GALERÍA y PRENSA.
 *
 * Igual que epk-write.ts: el trabajo vive acá y app/api/artists/[slug]/* lo expone por
 * HTTP, así que la app móvil llama los mismos endpoints. Nada de acá toca un request de
 * Next — el llamador pasa el email que actúa.
 *
 * Node-only. Nunca importar desde un client component.
 *
 * ============================================================
 * EL TOPE DE 12 FOTOS ES ATÓMICO, Y ESA ES LA PIEZA DELICADA
 * ============================================================
 *
 * Un CHECK no puede contar filas de su propia tabla —Postgres rechaza subconsultas en un
 * constraint— así que el tope tiene que estar acá. Lo que NO puede ser es un "contar y
 * después insertar" en dos consultas: cada sql del driver HTTP de Neon es su propio
 * request, así que entre el COUNT y el INSERT hay una ventana real de un round-trip en la
 * que dos subidas del mismo DJ ven 11 y las dos entran.
 *
 * Entonces el conteo va DENTRO del INSERT, en su propio WHERE: una sola sentencia, atómica
 * sin pedirlo. Es el mismo razonamiento que el índice único parcial de la residencia — la
 * guarda tiene que estar donde la carrera no la pueda saltar — y el mismo que los CTE que
 * modifican datos en events-write.
 *
 * Y COMO EL INSERT PUEDE NO INSERTAR NADA, hay que distinguir dos cosas que se parecen: 0
 * filas devueltas porque se llegó al tope, de 0 filas por cualquier otro motivo. Se
 * resuelve preguntando el conteo DESPUÉS, solo en el camino en que no insertó, para poder
 * devolver un 409 que dice cuántas hay en vez de un error genérico.
 */

import { neon } from "@neondatabase/serverless";
import { canEditArtist } from "./artists-write";
import { MAX_FOTOS } from "./galeria-limites";

const sql = neon(process.env.DATABASE_URL!);

export type WriteResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/**
 * El tope se RE-EXPORTA desde lib/galeria-limites.ts, que no importa nada. La sección de
 * galería es un client component y necesita el número para decirlo en pantalla; importarlo
 * de acá le metería el cliente de la base al bundle del navegador. Una sola definición,
 * dos consumidores.
 */
export { MAX_FOTOS };

const MAX_URL = 600;
const MAX_CREDITO = 120;
const MAX_MEDIO = 120;

/**
 * Los mismos blancos que los CHECK de la base: espacio, tab, CR, LF y espacio duro. El
 * \u00A0 va como ESCAPE y no como carácter literal — escrito literal, cualquiera que
 * "limpie espacios" en esta línea lo retipea como espacio normal sin ver lo que no se ve, y
 * entonces el código acepta un texto que la base rechaza. Que los dos recorten lo mismo es
 * lo que evita que haya un valor válido para uno e inválido para el otro.
 */
const BLANCOS = /^[\s\u00A0]+|[\s\u00A0]+$/g;

function limpiar(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.replace(BLANCOS, "");
  if (t === "" || t.length > max) return null;
  return t;
}

/** Igual que limpiar, pero vacío u omitido es un null legítimo y no un error. */
function opcional(valor: unknown, max: number): string | null | undefined {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string") return undefined;
  const t = valor.replace(BLANCOS, "");
  if (t === "") return null;
  return t.length > max ? undefined : t;
}

/** Solo http(s) llega a un href o a un src. Misma regla que el resto del EPK. */
function limpiarUrl(valor: unknown): string | null {
  const t = limpiar(valor, MAX_URL);
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return t;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD real, o null. Nullable a propósito: una nota vieja puede no tener fecha, y
 *  la regla del repo es no inventar datos. */
function limpiarFecha(valor: unknown): string | null | undefined {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string") return undefined;
  const t = valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) return undefined;
  return t;
}

/**
 * Una sola puerta para las dos secciones. Galería y prensa son CONTENIDO del perfil, así
 * que las edita quien edita el perfil: su dueño y el SUPER_ADMIN. Se deriva de
 * canEditArtist y no se reimplementa, porque dos derivaciones del mismo permiso es cómo las
 * dos se desincronizan.
 */
async function autorizar(
  artistSlug: string,
  actorEmail?: string | null
): Promise<WriteResult<undefined>> {
  const [existe] = await sql`SELECT slug FROM artists WHERE slug = ${artistSlug}`;
  if (!existe) return { ok: false, status: 404, error: "Artist not found" };
  if (!actorEmail) return { ok: false, status: 403, error: "Not allowed" };
  const puede = await canEditArtist(artistSlug, actorEmail);
  if (!puede) return { ok: false, status: 403, error: "Not allowed" };
  return { ok: true, value: undefined };
}

/* ===================================================================
 * GALERÍA
 * =================================================================== */

export type NuevaFoto = { url?: unknown; credit?: unknown; sortOrder?: unknown };

export async function crearFoto(
  artistSlug: string,
  input: NuevaFoto,
  actorEmail?: string | null
): Promise<WriteResult<{ id: number }>> {
  const auth = await autorizar(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const url = limpiarUrl(input.url);
  if (!url) return { ok: false, status: 400, error: "url must be an http(s) URL" };

  const credit = opcional(input.credit, MAX_CREDITO);
  if (credit === undefined) {
    return { ok: false, status: 400, error: `credit must be text under ${MAX_CREDITO} chars` };
  }

  const sortOrder = limpiarOrden(input.sortOrder);
  if (sortOrder === undefined) {
    return { ok: false, status: 400, error: "sortOrder must be a whole number" };
  }

  /**
   * EL TOPE, ADENTRO DEL INSERT. El SELECT del WHERE y el INSERT son la misma sentencia, así
   * que dos subidas simultáneas no pueden ver las dos el mismo conteo: la segunda ve el
   * efecto de la primera o no inserta.
   */
  const filas = await sql`
    INSERT INTO artist_photos (artist_slug, url, credit, sort_order)
    SELECT ${artistSlug}, ${url}, ${credit}, ${sortOrder}
    WHERE (SELECT COUNT(*) FROM artist_photos WHERE artist_slug = ${artistSlug}) < ${MAX_FOTOS}
    RETURNING id
  `;

  if (filas.length === 0) {
    /**
     * No insertó. El único motivo posible es el tope —el resto ya se validó arriba y un
     * artista inexistente habría dado 404— pero se CUENTA en vez de afirmarlo, para que el
     * mensaje diga el número y no "algo pasó".
     */
    const [c] = await sql`
      SELECT COUNT(*)::int AS n FROM artist_photos WHERE artist_slug = ${artistSlug}
    `;
    return {
      ok: false,
      status: 409,
      error: `Ya hay ${c.n} fotos y el tope es ${MAX_FOTOS}. Borrá una antes de subir otra.`,
    };
  }

  return { ok: true, value: { id: filas[0].id as number } };
}

export async function borrarFoto(
  artistSlug: string,
  fotoId: number,
  actorEmail?: string | null
): Promise<WriteResult<{ borrada: boolean }>> {
  const auth = await autorizar(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  /**
   * EL artist_slug VA EN EL WHERE ADEMÁS DEL id, y no es redundante: sin él, el dueño de un
   * perfil podría borrar la foto de otro mandando un id ajeno. La autorización dice que
   * puede editar ESTE perfil, no cualquiera.
   */
  const filas = await sql`
    DELETE FROM artist_photos WHERE id = ${fotoId} AND artist_slug = ${artistSlug}
    RETURNING id
  `;
  if (filas.length === 0) return { ok: false, status: 404, error: "Photo not found" };
  return { ok: true, value: { borrada: true } };
}

export async function reordenarFoto(
  artistSlug: string,
  fotoId: number,
  sortOrder: unknown,
  actorEmail?: string | null
): Promise<WriteResult<{ id: number }>> {
  const auth = await autorizar(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const orden = limpiarOrden(sortOrder);
  if (orden === undefined) {
    return { ok: false, status: 400, error: "sortOrder must be a whole number or null" };
  }

  const filas = await sql`
    UPDATE artist_photos SET sort_order = ${orden}
    WHERE id = ${fotoId} AND artist_slug = ${artistSlug}
    RETURNING id
  `;
  if (filas.length === 0) return { ok: false, status: 404, error: "Photo not found" };
  return { ok: true, value: { id: filas[0].id as number } };
}

/* ===================================================================
 * PRENSA
 * =================================================================== */

export type NuevaNota = {
  outlet?: unknown;
  url?: unknown;
  publishedAt?: unknown;
  sortOrder?: unknown;
};

export async function crearNota(
  artistSlug: string,
  input: NuevaNota,
  actorEmail?: string | null
): Promise<WriteResult<{ id: number }>> {
  const auth = await autorizar(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const outlet = limpiar(input.outlet, MAX_MEDIO);
  if (!outlet) {
    return { ok: false, status: 400, error: `outlet is required, text under ${MAX_MEDIO} chars` };
  }

  const url = limpiarUrl(input.url);
  if (!url) return { ok: false, status: 400, error: "url must be an http(s) URL" };

  const publishedAt = limpiarFecha(input.publishedAt);
  if (publishedAt === undefined) {
    return { ok: false, status: 400, error: "publishedAt must be a real YYYY-MM-DD date" };
  }

  const sortOrder = limpiarOrden(input.sortOrder);
  if (sortOrder === undefined) {
    return { ok: false, status: 400, error: "sortOrder must be a whole number" };
  }

  /** La prensa NO tiene tope: no se decidió ninguno, y un tope que nadie pidió es una
   *  restricción inventada. */
  const filas = await sql`
    INSERT INTO artist_press (artist_slug, outlet, url, published_at, sort_order)
    VALUES (${artistSlug}, ${outlet}, ${url}, ${publishedAt}::date, ${sortOrder})
    RETURNING id
  `;
  return { ok: true, value: { id: filas[0].id as number } };
}

export async function borrarNota(
  artistSlug: string,
  notaId: number,
  actorEmail?: string | null
): Promise<WriteResult<{ borrada: boolean }>> {
  const auth = await autorizar(artistSlug, actorEmail);
  if (!auth.ok) return auth;
  const filas = await sql`
    DELETE FROM artist_press WHERE id = ${notaId} AND artist_slug = ${artistSlug}
    RETURNING id
  `;
  if (filas.length === 0) return { ok: false, status: 404, error: "Press item not found" };
  return { ok: true, value: { borrada: true } };
}

/**
 * NULL = sin posición manual, igual que dj_sets y tracks. Devuelve undefined cuando el
 * valor es inválido, para que el llamador pueda distinguirlo de un null legítimo: son dos
 * cosas distintas y colapsarlas haría que un "abc" se guardara como "sin posición".
 */
function limpiarOrden(valor: unknown): number | null | undefined {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).trim());
  if (!Number.isInteger(n) || n < 0 || n > 9999) return undefined;
  return n;
}
