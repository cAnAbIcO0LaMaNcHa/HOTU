/**
 * Write logic for collective membership.
 *
 * Per the repo rule the work lives here and app/api/collectives/[slug]/*
 * exposes it over HTTP. Nothing here touches a Next request context — the
 * caller passes the acting email in, so the mobile app can use the same
 * functions through the same endpoints.
 *
 * The 3-DJs/2-residents minimum is GONE (tanda 3, §1.1). There is no
 * publishable/incomplete state and nothing recomputes one: a collective
 * with a single member can publish. recalcMembership() and its constants
 * were removed from here rather than left unused, because a rule that
 * still exists in the code is a rule somebody will call again.
 *
 * collectives.status_membership is NOT dropped — a column never goes in
 * the same migration that stops using it — it is simply frozen at whatever
 * it last held and no longer read or written.
 *
 * Node-only. Never import from a client component.
 */

import { neon } from "@neondatabase/serverless";
import { isSuperAdmin } from "./roles-check";

const sql = neon(process.env.DATABASE_URL!);

/**
 * casa      — the DJ's main collective. ONE only, and only ever a
 *             collective: a venue is somewhere you are resident, not home.
 * residente — the general link. Several at a time, collectives or venues.
 *
 * Careful reading anything written before tanda 3: "residente" used to be
 * the exclusive one. The word kept its spelling and swapped its meaning.
 */
export type MembershipKind = "casa" | "residente";

export type WriteResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

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

/*
 * addMember was removed in tanda 3, pieza 3. A collective can no longer
 * add somebody outright: a membership only counts with both sides
 * agreeing, so what used to be an add is now an invitation that the DJ
 * has to accept. That lives in lib/membership-write.ts.
 *
 * Deleted rather than left unused, for the same reason recalcMembership
 * was: a function that still exists is a function somebody calls.
 */

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
): Promise<WriteResult<{ closed: number }>> {
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

  return { ok: true, value: { closed: closed.length } };
}

/**
 * Edits the collective's own text: name, bio and sector.
 *
 * The slug is NOT editable here. It is the primary key and the target of
 * four foreign keys, and although they all carry ON UPDATE CASCADE, a
 * changed slug silently breaks every link anybody has ever shared. If a
 * rename is ever wanted it needs to be its own deliberate operation.
 *
 * district is left out on purpose: the district system is on its way out
 * (HOTFIX punto 1) and adding an editor for a field being removed would
 * be work done twice.
 *
 * Every field is optional — an absent key means "leave it alone", which is
 * what makes this safe to call from a form that only shows some of them.
 * An empty string clears the nullable ones; name cannot be blanked,
 * because a collective with no name is not displayable anywhere.
 */
export async function updateCollectiveInfo(
  slug: string,
  patch: { name?: unknown; bio?: unknown; sector?: unknown },
  email?: string | null
): Promise<WriteResult<{ updated: string[] }>> {
  if (!(await canEditCollective(slug, email))) {
    return { ok: false, status: 403, error: "No podés editar este colectivo" };
  }

  const updated: string[] = [];

  if (patch.name !== undefined) {
    if (typeof patch.name !== "string" || patch.name.trim() === "") {
      return { ok: false, status: 400, error: "El nombre no puede quedar vacío" };
    }
    const name = patch.name.trim().slice(0, 120);
    await sql`UPDATE collectives SET name = ${name} WHERE slug = ${slug}`;
    updated.push("name");
  }

  if (patch.bio !== undefined) {
    if (typeof patch.bio !== "string") {
      return { ok: false, status: 400, error: "La bio tiene que ser texto" };
    }
    const bio = patch.bio.trim().slice(0, 4000);
    await sql`UPDATE collectives SET bio = ${bio} WHERE slug = ${slug}`;
    updated.push("bio");
  }

  if (patch.sector !== undefined) {
    if (typeof patch.sector !== "string") {
      return { ok: false, status: 400, error: "El sector tiene que ser texto" };
    }
    const sector = patch.sector.trim().slice(0, 120);
    await sql`UPDATE collectives SET sector = ${sector || null} WHERE slug = ${slug}`;
    updated.push("sector");
  }

  if (updated.length === 0) {
    return { ok: false, status: 400, error: "No mandaste ningún campo para cambiar" };
  }

  return { ok: true, value: { updated } };
}
