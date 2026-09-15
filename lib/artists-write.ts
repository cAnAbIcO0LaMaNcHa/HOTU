/**
 * Write logic for the artist profile (EPK).
 *
 * Per the repo rule, this module holds the work and app/api/artists/[slug]
 * exposes it over HTTP — no component writes directly. The mobile app will
 * call the same endpoint, so nothing here may depend on a Next request
 * context: the caller passes the acting email in.
 *
 * Node-only. Never import from a client component.
 */

import { neon } from "@neondatabase/serverless";
import { SOCIAL_PLATFORMS, type ArtistSocials, type SocialPlatform } from "./socials";
import { deleteOwnBlob } from "./blob";
import { isSuperAdmin } from "./roles-check";
// El WriteResult de este archivo no es genérico y no contempla 409, que
// es justo lo que el alta necesita (código tomado, ya tenés un perfil).
// Se usa el genérico de collectives-write, que es el mismo que ya usan
// membership-write y genres-write.
import { validateGenreSelection } from "./genres-write";
import type { WriteResult as Resultado } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Everything a DJ may change about their own profile.
 *
 * Deliberately absent: anything derived from sales. Attribution numbers are
 * the whole value of the press kit — an organiser can only trust them
 * because the artist cannot touch them. Also absent: slug, district, status
 * and dj_code, which are identity and editorial decisions rather than
 * profile content.
 */
export type ArtistProfilePatch = {
  name?: string;
  role?: string;
  genre?: string;
  city?: string;
  origin?: string;
  bio?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  photo?: string | null;
  coverUrl?: string | null;
  bpmMin?: number | null;
  bpmMax?: number | null;
  socials?: ArtistSocials;
};

export type WriteResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * True when `email` owns this artist profile, or is a SUPER_ADMIN.
 *
 * Used twice: by the API route to authorise the write, and by the profile
 * page to decide whether to render the edit affordances at all. Both must
 * agree, so they call the same function — hiding a button is presentation,
 * never protection.
 */
export async function canEditArtist(slug: string, email?: string | null): Promise<boolean> {
  if (!email) return false;
  const rows = await sql`SELECT owner_email FROM artists WHERE slug = ${slug}`;
  if (rows.length === 0) return false;
  const owner = rows[0].owner_email as string | null;
  if (owner && owner.toLowerCase() === email.toLowerCase()) return true;
  return await isSuperAdmin(email);
}

const MAX_LENGTHS: Record<string, number> = {
  name: 80,
  role: 60,
  genre: 40,
  city: 80,
  origin: 80,
  bio: 4000,
  contactEmail: 160,
  contactPhone: 40,
  photo: 2000,
  coverUrl: 2000,
};

/** Empty string from a cleared input means "unset", not "store a blank". */
function cleanText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Only http(s) links are accepted. Without this a stored "javascript:" URL
 * would be rendered straight into an href on a public profile.
 */
function cleanUrl(value: unknown): string | null | undefined {
  const text = cleanText(value);
  if (text === undefined || text === null) return text;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function cleanSocials(value: unknown): ArtistSocials | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const out: ArtistSocials = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const url = cleanUrl(input[platform]);
    // undefined = not sent or invalid, null = cleared. Both mean "no link".
    if (typeof url === "string") out[platform as SocialPlatform] = url;
  }
  return out;
}

/**
 * Applies a patch to an artist profile after checking that `actorEmail` is
 * allowed to. Returns a typed result instead of throwing so the API route
 * can map it to a status code without pattern-matching on error strings.
 */
export async function updateArtistProfile(
  slug: string,
  patch: ArtistProfilePatch,
  actorEmail?: string | null
): Promise<WriteResult> {
  const rows = await sql`SELECT slug, photo, cover_url, status FROM artists WHERE slug = ${slug}`;
  if (rows.length === 0) return { ok: false, status: 404, error: "Artist not found" };
  const previous = {
    photo: (rows[0].photo as string | null) ?? null,
    coverUrl: (rows[0].cover_url as string | null) ?? null,
  };

  if (!(await canEditArtist(slug, actorEmail))) {
    // 403 si el perfil es público, 404 si no lo es.
    //
    // Sobre un artista publicado, su existencia ya es pública, así que un
    // 403 no cuenta nada nuevo y es el error honesto. Sobre un BORRADOR,
    // un 403 confirmaría que el slug existe, y con eso se enumeran los
    // borradores probando nombres contra esta ruta. Para quien no puede
    // verlo, tiene que ser indistinguible de un slug que no existe.
    const publico = (rows[0].status as string) === "published";
    return publico
      ? { ok: false, status: 403, error: "Not allowed to edit this profile" }
      : { ok: false, status: 404, error: "Artist not found" };
  }

  // name, genre, city and bio are NOT NULL in the table, so an explicit
  // clear has to be rejected rather than written as null.
  const required: Array<keyof ArtistProfilePatch> = ["name", "genre", "city", "bio"];
  const values: Record<string, string | number | null> = {};

  for (const key of ["name", "role", "genre", "city", "origin", "bio", "contactEmail", "contactPhone"] as const) {
    const cleaned = cleanText(patch[key]);
    if (cleaned === undefined) continue;
    if (cleaned === null && required.includes(key)) {
      return { ok: false, status: 400, error: `${key} cannot be empty` };
    }
    const max = MAX_LENGTHS[key];
    if (cleaned !== null && max && cleaned.length > max) {
      return { ok: false, status: 400, error: `${key} is longer than ${max} characters` };
    }
    values[key] = cleaned;
  }

  for (const key of ["photo", "coverUrl"] as const) {
    if (patch[key] === undefined) continue;
    const cleaned = cleanUrl(patch[key]);
    if (cleaned === undefined) {
      return { ok: false, status: 400, error: `${key} must be an http(s) URL` };
    }
    values[key] = cleaned;
  }

  for (const key of ["bpmMin", "bpmMax"] as const) {
    const raw = patch[key];
    if (raw === undefined) continue;
    if (raw === null) {
      values[key] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 60 || n > 300) {
      return { ok: false, status: 400, error: `${key} must be a whole number between 60 and 300` };
    }
    values[key] = n;
  }

  const min = values.bpmMin ?? null;
  const max = values.bpmMax ?? null;
  if (typeof min === "number" && typeof max === "number" && min > max) {
    return { ok: false, status: 400, error: "bpmMin cannot be greater than bpmMax" };
  }

  const socials = patch.socials === undefined ? undefined : cleanSocials(patch.socials);
  if (patch.socials !== undefined && socials === undefined) {
    return { ok: false, status: 400, error: "socials must be an object of platform -> URL" };
  }

  if (Object.keys(values).length === 0 && socials === undefined) {
    return { ok: false, status: 400, error: "Nothing to update" };
  }

  // COALESCE keeps every column the patch did not mention untouched, so a
  // partial save from one section never wipes another section's fields.
  await sql`
    UPDATE artists SET
      name          = COALESCE(${values.name ?? null}, name),
      genre         = COALESCE(${values.genre ?? null}, genre),
      city          = COALESCE(${values.city ?? null}, city),
      bio           = COALESCE(${values.bio ?? null}, bio),
      origin        = CASE WHEN ${"origin" in values} THEN ${values.origin ?? null}::text ELSE origin END,
      role          = CASE WHEN ${"role" in values} THEN ${values.role ?? null}::text ELSE role END,
      contact_email = CASE WHEN ${"contactEmail" in values} THEN ${values.contactEmail ?? null}::text ELSE contact_email END,
      contact_phone = CASE WHEN ${"contactPhone" in values} THEN ${values.contactPhone ?? null}::text ELSE contact_phone END,
      photo         = CASE WHEN ${"photo" in values} THEN ${values.photo ?? null}::text ELSE photo END,
      cover_url     = CASE WHEN ${"coverUrl" in values} THEN ${values.coverUrl ?? null}::text ELSE cover_url END,
      bpm_min       = CASE WHEN ${"bpmMin" in values} THEN ${values.bpmMin ?? null}::smallint ELSE bpm_min END,
      bpm_max       = CASE WHEN ${"bpmMax" in values} THEN ${values.bpmMax ?? null}::smallint ELSE bpm_max END,
      socials       = CASE WHEN ${socials !== undefined} THEN ${JSON.stringify(socials ?? {})}::jsonb ELSE socials END
    WHERE slug = ${slug}
  `;

  // Clean up whatever the save replaced. Without this every photo change
  // leaves the old file behind forever, and the 1GB free tier is not big
  // enough to absorb that.
  //
  // Only OUR blobs are deleted, and only when the value actually changed —
  // deleteOwnBlob checks the host against the store in the token, so a URL
  // the DJ pasted from somewhere else is left alone. It also never throws:
  // the row is already written, and failing the request over a leftover
  // file would be the worse outcome.
  if ("photo" in values && values.photo !== previous.photo) {
    await deleteOwnBlob(previous.photo);
  }
  if ("coverUrl" in values && values.coverUrl !== previous.coverUrl) {
    await deleteOwnBlob(previous.coverUrl);
  }

  return { ok: true };
}

/* ===================================================================
 * ALTA DE UN PERFIL DE DJ (ALTA-DJ paso 3)
 * =================================================================== */

const DJ_CODE_MIN = 3;
const DJ_CODE_MAX = 12;

/**
 * Propone un código de DJ a partir del nombre artístico.
 *
 * El código se dicta en voz alta en la puerta, así que solo letras: sin
 * guiones, sin números, sin acentos. Se propone la primera palabra del
 * nombre, que es como la gente se presenta.
 *
 * NO es el código final: el DJ lo edita. Es su identidad y la va a decir
 * en voz alta mil veces, así que tiene que poder elegirla. La propuesta
 * existe porque un campo vacío con "3 a 12 letras, único" produce
 * códigos malos: o el nombre completo, o algo impronunciable.
 */
export function proponerDjCode(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .trim();
  const palabras = limpio.split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "";
  // La primera palabra si alcanza; si es muy corta se le pega la
  // siguiente, porque "DJ" solo no distingue a nadie.
  let code = palabras[0];
  for (let i = 1; i < palabras.length && code.length < 4; i++) code += palabras[i];
  return code.slice(0, DJ_CODE_MAX);
}

/** ¿Está libre ese código? Case-insensitive, igual que el índice único. */
export async function djCodeLibre(code: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM artists WHERE upper(dj_code) = upper(${code})`;
  return rows.length === 0;
}

/** Nombre a slug: sin acentos, sin espacios, minúsculas. */
export function slugDeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Un slug que nadie esté usando. Cuenta hacia arriba con un sufijo
 * legible en vez de algo aleatorio, porque alguien lo va a leer en voz
 * alta y a escribirlo a mano.
 */
export async function slugLibreDesde(base: string): Promise<string> {
  const raiz = base || "dj";
  for (let n = 1; n < 100; n++) {
    const candidato = n === 1 ? raiz : `${raiz}-${n}`;
    const tomado = await sql`SELECT 1 FROM artists WHERE slug = ${candidato}`;
    if (tomado.length === 0) return candidato;
  }
  return `${raiz}-${Date.now()}`;
}

export type CreateArtistInput = {
  name: unknown;
  djCode: unknown;
  city: unknown;
  origin?: unknown;
  primaryBranch: unknown;
  secondaryBranches?: unknown;
  tags?: unknown;
};

/**
 * Crea el perfil de DJ de una cuenta.
 *
 * UNA SOLA ESCRITURA, AL FINAL. El formulario son dos pasos pero no
 * escribe nada hasta que los dos están completos: un alta abandonada a
 * mitad no puede dejar una fila a medio llenar, ni un slug ocupado, ni
 * un dj_code reservado que nadie va a usar. Todo va en una transacción.
 *
 * NACE EN BORRADOR. status='draft' y review_status='borrador', los dos
 * EXPLÍCITOS aunque los defaults ya digan eso. El default es la red, no
 * el plan: esta es exactamente la función cuya distracción publicaría a
 * cualquiera que se registre. Publicar es del admin, después de revisar.
 *
 * artists.genre se llena con el NOMBRE del branch primario. Es una
 * columna vieja NOT NULL que la tanda 4 §3 reemplaza, y llenarla desde
 * el branch mantiene andando el filtro actual de /artistas hasta
 * entonces, en vez de dejar un string vacío que no significa nada.
 *
 * district no se nombra: sale del DEFAULT 'D00' de la migración. Es el
 * distrito T/RAP y no lo eligió nadie, cosa anotada y aceptada en
 * ALTA-DJ.md porque el sistema entero se borra en la §3.
 */
export async function createArtist(
  input: CreateArtistInput,
  email: string
): Promise<Resultado<{ slug: string; djCode: string }>> {
  // --- uno por cuenta -----------------------------------------------
  const yaTiene = await sql`
    SELECT slug FROM artists WHERE lower(owner_email) = lower(${email}) LIMIT 1
  `;
  if (yaTiene.length > 0) {
    return { ok: false, status: 409, error: "Ya tenés un perfil de DJ. Es uno por cuenta." };
  }

  // --- identidad ----------------------------------------------------
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return { ok: false, status: 400, error: "Poné un nombre de entre 2 y 80 caracteres" };
  }

  const djCode = typeof input.djCode === "string" ? input.djCode.trim().toUpperCase() : "";
  if (!new RegExp(`^[A-Z]{${DJ_CODE_MIN},${DJ_CODE_MAX}}$`).test(djCode)) {
    return {
      ok: false,
      status: 400,
      error: `El código tiene que ser de ${DJ_CODE_MIN} a ${DJ_CODE_MAX} letras, sin números ni guiones`,
    };
  }
  if (!(await djCodeLibre(djCode))) {
    return { ok: false, status: 409, error: `El código ${djCode} ya está tomado` };
  }

  const city = typeof input.city === "string" ? input.city.trim() : "";
  if (city.length < 2 || city.length > 80) {
    return { ok: false, status: 400, error: "Poné la ciudad donde vivís" };
  }
  const origin =
    typeof input.origin === "string" && input.origin.trim()
      ? input.origin.trim().slice(0, 80)
      : null;

  // --- género -------------------------------------------------------
  // Las mismas reglas que usa la edición, en la misma función.
  const genero = await validateGenreSelection({
    primaryBranch: String(input.primaryBranch ?? ""),
    secondaryBranches: Array.isArray(input.secondaryBranches)
      ? (input.secondaryBranches as unknown[]).map(String)
      : [],
    tags: Array.isArray(input.tags)
      ? (input.tags as Array<Record<string, unknown>>).map((t) => ({
          slug: String(t?.slug ?? ""),
          branchCode: String(t?.branchCode ?? ""),
        }))
      : [],
  });
  if (!genero.ok) return genero;
  const { primary, secundarios, tagsUnicos } = genero.value;

  const [rama] = await sql`SELECT name FROM genre_branches WHERE code = ${primary}`;
  const nombreDeRama = (rama?.name as string) ?? primary;

  const slug = await slugLibreDesde(slugDeNombre(name));

  // --- la escritura, entera y de una sola vez ------------------------
  try {
    await sql.transaction([
      sql`
        INSERT INTO artists
          (slug, name, genre, city, origin, bio, joined_at,
           owner_email, contact_email, dj_code, status, review_status)
        VALUES
          (${slug}, ${name}, ${nombreDeRama}, ${city}, ${origin}, '', CURRENT_DATE,
           ${email}, ${email}, ${djCode}, 'draft', 'borrador')
      `,
      sql`
        INSERT INTO artist_genres (artist_slug, branch_code, is_primary, sort_order)
        VALUES (${slug}, ${primary}, true, 0)
      `,
      ...secundarios.map(
        (c, i) => sql`
          INSERT INTO artist_genres (artist_slug, branch_code, is_primary, sort_order)
          VALUES (${slug}, ${c}, false, ${i + 1})
        `
      ),
      ...tagsUnicos.map(
        (t, i) => sql`
          INSERT INTO artist_genre_tags (artist_slug, tag_slug, branch_code, sort_order)
          VALUES (${slug}, ${t.slug}, ${t.branchCode}, ${i})
        `
      ),
    ]);
  } catch (err) {
    // Dos personas pueden pedir el mismo código o el mismo slug entre la
    // comprobación de más arriba y este INSERT. El índice único es el que
    // decide de verdad; acá solo se traduce a algo que se entienda, en
    // vez de un 500 con el texto de un constraint.
    const m = err instanceof Error ? err.message : String(err);
    if (m.includes("artists_dj_code_upper_idx")) {
      return { ok: false, status: 409, error: `El código ${djCode} lo tomaron recién. Elegí otro.` };
    }
    if (m.includes("artists_pkey")) {
      return {
        ok: false,
        status: 409,
        error: "Esa dirección de perfil la tomaron recién. Probá con otro nombre.",
      };
    }
    throw err;
  }

  return { ok: true, value: { slug, djCode } };
}
