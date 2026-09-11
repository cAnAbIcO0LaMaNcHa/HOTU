/**
 * Write logic for collectives: membership, and the status_membership rule
 * that depends on it.
 *
 * Per the repo rule the work lives here and app/api/collectives/[slug]/*
 * exposes it over HTTP. Nothing here touches a Next request context — the
 * caller passes the acting email in, so the mobile app can use the same
 * functions through the same endpoints.
 *
 * Node-only. Never import from a client component.
 */

import { neon } from "@neondatabase/serverless";
import { isSuperAdmin } from "./roles-check";

const sql = neon(process.env.DATABASE_URL!);

export type MembershipKind = "residente" | "toca_con";

export type WriteResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/** A collective is publishable with 3+ DJs of whom 2+ are residents. */
const MIN_DJS = 3;
const MIN_RESIDENTES = 2;

/**
 * Recomputes and stores status_membership from the active memberships.
 *
 * The rule applied rather than assumed, in one place: this used to live
 * inside the seed route, and the moment a second caller needed it the
 * duplication was going to drift. Every path that changes a membership
 * calls this afterwards.
 *
 * Counted DISTINCT because one artist can hold an active 'residente' and
 * an active 'toca_con' row for the same collective, and must not count
 * twice toward the minimum.
 */
export async function recalcMembership(collectiveSlug: string): Promise<"activo" | "incompleto"> {
  const [counts] = await sql`
    SELECT
      COUNT(DISTINCT artist_slug)::int AS djs,
      COUNT(DISTINCT artist_slug) FILTER (WHERE kind = 'residente')::int AS residentes
    FROM artist_collectives
    WHERE collective_slug = ${collectiveSlug} AND to_date IS NULL
  `;
  const status =
    counts.djs >= MIN_DJS && counts.residentes >= MIN_RESIDENTES ? "activo" : "incompleto";
  await sql`UPDATE collectives SET status_membership = ${status} WHERE slug = ${collectiveSlug}`;
  return status;
}

/**
 * Who may change a collective's membership: its owner, or a SUPER_ADMIN.
 *
 * Mirrors canEditArtist. Used by the API route to authorise and by the
 * admin page to decide what to render, so both run the same check.
 */
export async function canEditCollective(slug: string, email?: string | null): Promise<boolean> {
  if (!email) return false;
  const rows = await sql`SELECT owner_email FROM collectives WHERE slug = ${slug}`;
  if (rows.length === 0) return false;
  const owner = rows[0].owner_email as string | null;
  if (owner && owner.toLowerCase() === email.toLowerCase()) return true;
  return await isSuperAdmin(email);
}

/**
 * Adds an artist to a collective.
 *
 * "Residente de" is exclusive — it is the link that counts money, so an
 * artist can only hold one at a time. The partial unique index would
 * reject a second one anyway, but a caller deserves to be told WHICH
 * collective they are already resident of, not a raw constraint violation.
 */
export async function addMember(
  collectiveSlug: string,
  artistSlug: string,
  kind: MembershipKind,
  actorEmail?: string | null
): Promise<WriteResult<{ status: "activo" | "incompleto" }>> {
  if (kind !== "residente" && kind !== "toca_con") {
    return { ok: false, status: 400, error: "kind must be 'residente' or 'toca_con'" };
  }

  const collective = await sql`SELECT slug FROM collectives WHERE slug = ${collectiveSlug}`;
  if (collective.length === 0) {
    return { ok: false, status: 404, error: "Collective not found" };
  }
  const artist = await sql`SELECT slug, name FROM artists WHERE slug = ${artistSlug}`;
  if (artist.length === 0) {
    return { ok: false, status: 404, error: `No existe el artista "${artistSlug}"` };
  }

  if (!(await canEditCollective(collectiveSlug, actorEmail))) {
    return { ok: false, status: 403, error: "Not allowed to edit this collective" };
  }

  const existing = await sql`
    SELECT 1 FROM artist_collectives
    WHERE artist_slug = ${artistSlug} AND collective_slug = ${collectiveSlug}
      AND kind = ${kind} AND to_date IS NULL
  `;
  if (existing.length > 0) {
    return { ok: false, status: 409, error: `${artist[0].name} ya está en el colectivo como ${kind}` };
  }

  if (kind === "residente") {
    const elsewhere = await sql`
      SELECT ac.collective_slug, c.name
      FROM artist_collectives ac
      JOIN collectives c ON c.slug = ac.collective_slug
      WHERE ac.artist_slug = ${artistSlug} AND ac.kind = 'residente' AND ac.to_date IS NULL
    `;
    if (elsewhere.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `${artist[0].name} ya es residente de ${elsewhere[0].name}. Un DJ solo puede ser residente de un colectivo: cerrá esa residencia primero.`,
      };
    }
  }

  await sql`
    INSERT INTO artist_collectives (artist_slug, collective_slug, kind, from_date, accepted_at)
    VALUES (${artistSlug}, ${collectiveSlug}, ${kind}, CURRENT_DATE, now())
  `;

  return { ok: true, value: { status: await recalcMembership(collectiveSlug) } };
}

/**
 * Removes an artist from a collective by CLOSING the membership, not
 * deleting it: "membresías con desde/hasta, el histórico es inmutable".
 * A deleted row would take its sales history's context with it.
 *
 * Closes every active link the artist holds in this collective, because
 * "sacar del colectivo" means exactly that — not "sacar como aliado but
 * leave the residency".
 */
export async function removeMember(
  collectiveSlug: string,
  artistSlug: string,
  actorEmail?: string | null
): Promise<WriteResult<{ status: "activo" | "incompleto"; closed: number }>> {
  const collective = await sql`SELECT slug FROM collectives WHERE slug = ${collectiveSlug}`;
  if (collective.length === 0) {
    return { ok: false, status: 404, error: "Collective not found" };
  }

  if (!(await canEditCollective(collectiveSlug, actorEmail))) {
    return { ok: false, status: 403, error: "Not allowed to edit this collective" };
  }

  const closed = await sql`
    UPDATE artist_collectives SET to_date = CURRENT_DATE
    WHERE artist_slug = ${artistSlug} AND collective_slug = ${collectiveSlug} AND to_date IS NULL
    RETURNING id
  `;
  if (closed.length === 0) {
    return { ok: false, status: 404, error: "Ese artista no tiene un vínculo activo con el colectivo" };
  }

  return {
    ok: true,
    value: { status: await recalcMembership(collectiveSlug), closed: closed.length },
  };
}
