/**
 * Likes on artists.
 *
 * A like is a follow, not a vote. It never changes ranking, ordering or
 * exposure anywhere — it exists so the user can be notified when that DJ
 * plays, and so the DJ can see how many people follow their work. Anything
 * that would turn it into a popularity signal is out of scope by design.
 *
 * artist_likes has a composite primary key (artist_slug, user_email), so
 * "one like per person per artist" is enforced by the table itself. These
 * functions lean on that instead of checking first and then inserting,
 * which would race with a double-click.
 *
 * Node-only. Never import from a client component.
 */

import { neon } from "@neondatabase/serverless";
import type { WriteResult } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Likes an artist on behalf of the signed-in account.
 *
 * Idempotent: liking twice is not an error, it is the state the caller
 * asked for. ON CONFLICT DO NOTHING keeps the original created_at, so a
 * second click cannot quietly reorder the user's list.
 *
 * The artist must exist and be published. The foreign key would catch a
 * missing slug anyway, but a 404 says what went wrong and a constraint
 * violation does not.
 */
export async function likeArtist(
  artistSlug: string,
  email: string
): Promise<WriteResult<{ liked: true; count: number }>> {
  const artist = await sql`
    SELECT slug FROM artists WHERE slug = ${artistSlug} AND status = 'published'
  `;
  if (artist.length === 0) {
    return { ok: false, status: 404, error: "Ese artista no existe" };
  }

  await sql`
    INSERT INTO artist_likes (artist_slug, user_email)
    VALUES (${artistSlug}, ${email})
    ON CONFLICT (artist_slug, user_email) DO NOTHING
  `;

  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n FROM artist_likes WHERE artist_slug = ${artistSlug}
  `;
  return { ok: true, value: { liked: true, count: n as number } };
}

/**
 * Removes the like. Also idempotent: unliking something that was never
 * liked leaves the caller exactly where they wanted to be.
 *
 * Scoped to the caller's own email, so nobody can remove somebody else's
 * like by passing a different address.
 */
export async function unlikeArtist(
  artistSlug: string,
  email: string
): Promise<WriteResult<{ liked: false; count: number }>> {
  await sql`
    DELETE FROM artist_likes
    WHERE artist_slug = ${artistSlug} AND user_email = ${email}
  `;

  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n FROM artist_likes WHERE artist_slug = ${artistSlug}
  `;
  return { ok: true, value: { liked: false, count: n as number } };
}

/**
 * Lo mismo sobre un colectivo o un venue (§11).
 *
 * UNA SOLA PAREJA DE FUNCIONES PARA LOS DOS, sin una sola condición de
 * entity_kind: un like es un like, y lo único que cambia entre las dos
 * entidades es la página desde la que se da. Es justamente el caso en el
 * que compartir tabla sale gratis, así que no hay que pagarle nada.
 *
 * collective_likes es espejo exacto de artist_likes: PK compuesta
 * (collective_slug, user_email), así que "un like por persona por
 * colectivo" lo garantiza la tabla y no hace falta leer antes de
 * escribir, que es lo que se correría con un doble click.
 */
export async function likeCollective(
  collectiveSlug: string,
  email: string
): Promise<WriteResult<{ liked: true; count: number }>> {
  // Publicado, sí; de un tipo en particular, no. Filtrar por entity_kind
  // acá haría que el mismo endpoint aceptara un colectivo y rechazara un
  // venue con un 404 que además mentiría, porque el venue existe.
  const filas = await sql`
    SELECT slug FROM collectives WHERE slug = ${collectiveSlug} AND status = 'published'
  `;
  if (filas.length === 0) {
    return { ok: false, status: 404, error: "Eso no existe" };
  }

  await sql`
    INSERT INTO collective_likes (collective_slug, user_email)
    VALUES (${collectiveSlug}, ${email})
    ON CONFLICT (collective_slug, user_email) DO NOTHING
  `;

  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n FROM collective_likes WHERE collective_slug = ${collectiveSlug}
  `;
  return { ok: true, value: { liked: true, count: n as number } };
}

/** Saca el like. Idempotente y acotado al email de quien llama. */
export async function unlikeCollective(
  collectiveSlug: string,
  email: string
): Promise<WriteResult<{ liked: false; count: number }>> {
  await sql`
    DELETE FROM collective_likes
    WHERE collective_slug = ${collectiveSlug} AND user_email = ${email}
  `;

  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n FROM collective_likes WHERE collective_slug = ${collectiveSlug}
  `;
  return { ok: true, value: { liked: false, count: n as number } };
}
