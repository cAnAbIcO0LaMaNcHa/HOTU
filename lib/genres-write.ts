/**
 * El género de un perfil (tanda 4, §2).
 *
 * Un perfil declara: un branch primario, hasta tres secundarios, y de
 * tres a ocho tags cuyos tres primeros son los primarios. Nada de eso
 * son CHECK de Postgres, porque cuentan filas hermanas y un CHECK no
 * puede. La base solo garantiza dos cosas: que no haya dos primarios
 * (índice único parcial) y que un tag no se repita en el mismo perfil.
 * El resto se hace cumplir acá.
 *
 * SE ESCRIBE ENTERO O NO SE ESCRIBE. El género de un perfil es un
 * conjunto, no una lista de filas sueltas: reemplazar implica borrar lo
 * anterior e insertar lo nuevo, y hacerlo en dos pasos dejaría una
 * ventana donde el perfil no tiene primario, que es un estado que las
 * reglas prohíben. Por eso todo va en una sola transacción.
 *
 * El orden importa y se guarda en sort_order, no se infiere: los tres
 * primeros tags son los primarios, y "los tres primeros" solo significa
 * algo si el orden es un dato y no el capricho de un ORDER BY.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { canEditArtist } from "./artists-write";
import { canEditCollective, type WriteResult } from "./collectives-write";
import { GENRE_RULES } from "./genre-taxonomy";

const sql = neon(process.env.DATABASE_URL!);

/** Las dos entidades que declaran género. Usuario y venue no (§2.3). */
export type GenreOwner = "artist" | "collective";

export type GenreSelection = {
  /** Obligatorio. El branch principal del perfil. */
  primaryBranch: string;
  /** Hasta 3. No puede repetir el primario. */
  secondaryBranches?: string[];
  /** De 3 a 8, en orden. Cada uno es un par (slug, branch). */
  tags: Array<{ slug: string; branchCode: string }>;
};

/**
 * Escribe el género de un perfil, reemplazando lo que hubiera.
 *
 * Devuelve qué quedó guardado, no lo que se pidió: si alguna vez
 * divergen, el llamador tiene que ver lo que está en la base.
 */
export async function setGenres(
  owner: GenreOwner,
  slug: string,
  selection: GenreSelection,
  email?: string | null
): Promise<WriteResult<{ primaryBranch: string; secondaryBranches: string[]; tags: number }>> {
  const permitido =
    owner === "artist"
      ? await canEditArtist(slug, email)
      : await canEditCollective(slug, email);
  if (!permitido) {
    return { ok: false, status: 403, error: "No podés editar este perfil" };
  }

  // --- forma de la selección --------------------------------------
  const primary = typeof selection.primaryBranch === "string" ? selection.primaryBranch.trim() : "";
  if (!primary) {
    return { ok: false, status: 400, error: "Elegí un género principal" };
  }

  const secundarios = Array.from(
    new Set((selection.secondaryBranches ?? []).map((s) => String(s).trim()).filter(Boolean))
  ).filter((c) => c !== primary);
  if (secundarios.length > GENRE_RULES.maxSecondaryBranches) {
    return {
      ok: false,
      status: 400,
      error: `Como máximo ${GENRE_RULES.maxSecondaryBranches} géneros secundarios`,
    };
  }

  const tags = Array.isArray(selection.tags) ? selection.tags : [];
  // Un tag cuenta una vez aunque venga de dos branches distintos. El
  // índice único lo rechazaría igual, pero un error claro es mejor que
  // una violación de constraint.
  const vistos = new Set<string>();
  const tagsUnicos: Array<{ slug: string; branchCode: string }> = [];
  for (const t of tags) {
    const s = String(t?.slug ?? "").trim();
    const b = String(t?.branchCode ?? "").trim();
    if (!s || !b) continue;
    if (vistos.has(s)) {
      return { ok: false, status: 400, error: `El tag "${s}" está repetido` };
    }
    vistos.add(s);
    tagsUnicos.push({ slug: s, branchCode: b });
  }
  if (tagsUnicos.length < GENRE_RULES.minTags || tagsUnicos.length > GENRE_RULES.maxTags) {
    return {
      ok: false,
      status: 400,
      error: `Elegí entre ${GENRE_RULES.minTags} y ${GENRE_RULES.maxTags} tags`,
    };
  }

  // --- que el vocabulario exista ----------------------------------
  // Los FK lo rechazarían, pero "no existe el branch XYZ" se entiende y
  // "violates foreign key constraint" no.
  const codigos = [primary, ...secundarios];
  const hay = await sql`SELECT code FROM genre_branches WHERE code = ANY(${codigos}::text[])`;
  const encontrados = new Set(hay.map((r) => r.code as string));
  const faltantes = codigos.filter((c) => !encontrados.has(c));
  if (faltantes.length > 0) {
    return { ok: false, status: 400, error: `Estos géneros no existen: ${faltantes.join(", ")}` };
  }

  for (const t of tagsUnicos) {
    const existe = await sql`
      SELECT 1 FROM genre_tags WHERE slug = ${t.slug} AND branch_code = ${t.branchCode}
    `;
    if (existe.length === 0) {
      return {
        ok: false,
        status: 400,
        error: `El tag "${t.slug}" no existe dentro de ${t.branchCode}`,
      };
    }
  }

  // --- escritura ---------------------------------------------------
  // Borrar e insertar en una sola transacción. En el medio el perfil no
  // tiene primario, y ese estado no puede ser visible para nadie.
  const col = owner === "artist" ? "artist_slug" : "collective_slug";
  const tablaBranches = owner === "artist" ? "artist_genres" : "collective_genres";
  const tablaTags = owner === "artist" ? "artist_genre_tags" : "collective_genre_tags";

  const queries = [
    sql(`DELETE FROM ${tablaBranches} WHERE ${col} = $1`, [slug]),
    sql(`DELETE FROM ${tablaTags} WHERE ${col} = $1`, [slug]),
    sql(
      `INSERT INTO ${tablaBranches} (${col}, branch_code, is_primary, sort_order) VALUES ($1, $2, true, 0)`,
      [slug, primary]
    ),
    ...secundarios.map((c, i) =>
      sql(
        `INSERT INTO ${tablaBranches} (${col}, branch_code, is_primary, sort_order) VALUES ($1, $2, false, $3)`,
        [slug, c, i + 1]
      )
    ),
    ...tagsUnicos.map((t, i) =>
      sql(
        `INSERT INTO ${tablaTags} (${col}, tag_slug, branch_code, sort_order) VALUES ($1, $2, $3, $4)`,
        [slug, t.slug, t.branchCode, i]
      )
    ),
  ];

  await sql.transaction(queries);

  return {
    ok: true,
    value: { primaryBranch: primary, secondaryBranches: secundarios, tags: tagsUnicos.length },
  };
}

/**
 * Borra el género de un perfil.
 *
 * Existe para poder volver atrás, no como parte del flujo normal: el
 * género es obligatorio y un perfil sin él va a mostrar el pedido de
 * completarlo. Los perfiles que ya existían nunca tuvieron uno, así que
 * ese estado tiene que ser representable de todos modos.
 */
export async function clearGenres(
  owner: GenreOwner,
  slug: string,
  email?: string | null
): Promise<WriteResult<{ cleared: true }>> {
  const permitido =
    owner === "artist"
      ? await canEditArtist(slug, email)
      : await canEditCollective(slug, email);
  if (!permitido) {
    return { ok: false, status: 403, error: "No podés editar este perfil" };
  }

  const col = owner === "artist" ? "artist_slug" : "collective_slug";
  const tablaBranches = owner === "artist" ? "artist_genres" : "collective_genres";
  const tablaTags = owner === "artist" ? "artist_genre_tags" : "collective_genre_tags";

  await sql.transaction([
    sql(`DELETE FROM ${tablaTags} WHERE ${col} = $1`, [slug]),
    sql(`DELETE FROM ${tablaBranches} WHERE ${col} = $1`, [slug]),
  ]);

  return { ok: true, value: { cleared: true } };
}

/**
 * Si el vocabulario está vacío, no se le puede exigir género a nadie.
 *
 * La regla es que branch y tags son obligatorios al crear una cuenta de
 * artista o colectivo (§2.3). Aplicarla contra un vocabulario vacío no
 * haría cumplir nada: haría imposible crear una cuenta, porque no habría
 * de dónde elegir. Hasta que la taxonomía esté sembrada, el alta sigue
 * andando y el perfil pide completar el género como cualquier otra
 * sección vacía.
 */
export async function genreVocabularyReady(): Promise<boolean> {
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM genre_branches`;
  return (n as number) > 0;
}
