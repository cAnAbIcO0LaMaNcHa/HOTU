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

/**
 * Creates a collective from a DJ's account (§4.1).
 *
 * One per account. The creator becomes owner_email and joins as a member
 * straight away — a collective with nobody in it is not a collective.
 *
 * §4.1 says the new collective is the founder's casa, and it is, UNLESS
 * they already have one somewhere else. In that case the link opens as
 * residente and the caller is handed the usual casa conflict, so the DJ
 * decides explicitly what happens to their old home. Moving it silently
 * here would be the exact thing the membership rules forbid, and founding
 * a collective is no more of an excuse than any other route.
 *
 * The collective is always created either way. That part of the request is
 * unambiguous; only the kind of the link is in question.
 */
export async function createCollective(
  name: unknown,
  email: string
): Promise<
  WriteResult<{ slug: string; kind: MembershipKind; casaTaken: { slug: string; name: string } | null }>
> {
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, status: 400, error: "Poné un nombre para el colectivo" };
  }
  const clean = name.trim().slice(0, 120);

  // Only a DJ can found one: the collective has to have a first member,
  // and that member is the founder's artist profile.
  const [artist] = await sql`
    SELECT slug, name, district, city FROM artists
    WHERE lower(owner_email) = lower(${email}) AND status = 'published'
    ORDER BY slug LIMIT 1
  `;
  if (!artist) {
    return {
      ok: false,
      status: 403,
      error: "Necesitás un perfil de DJ para crear un colectivo",
    };
  }

  const owned = await sql`
    SELECT slug FROM collectives WHERE lower(owner_email) = lower(${email})
  `;
  if (owned.length > 0) {
    return { ok: false, status: 409, error: "Ya tenés un colectivo. Es uno por cuenta." };
  }

  const slug = await freeSlug(clean);

  // The founder's own district and city seed the collective's, since a
  // crew starts out where its founder is. Both are editable afterwards.
  await sql`
    INSERT INTO collectives (slug, name, type, sector, bio, district, owner_email, status)
    VALUES (${slug}, ${clean}, 'LOCAL', ${artist.city ?? "Bogotá"}, '',
            ${artist.district ?? "D00"}, ${email}, 'published')
  `;

  // Does the founder already have a home elsewhere? The partial unique
  // index would refuse a second active casa, so ask before, not after.
  const [casa] = await sql`
    SELECT ac.collective_slug, c.name
    FROM artist_collectives ac
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.artist_slug = ${artist.slug}
      AND ac.kind = 'casa' AND ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
    LIMIT 1
  `;
  const kind: MembershipKind = casa ? "residente" : "casa";

  await sql`
    INSERT INTO artist_collectives
      (artist_slug, collective_slug, kind, from_date, accepted_at, requested_by)
    VALUES (${artist.slug}, ${slug}, ${kind}, CURRENT_DATE, now(), 'artist')
  `;

  return {
    ok: true,
    value: {
      slug,
      kind,
      casaTaken: casa ? { slug: casa.collective_slug as string, name: casa.name as string } : null,
    },
  };
}

/**
 * Turns a name into a slug nobody is using yet.
 *
 * The slug is the primary key and the public address, so a collision has
 * to be resolved at creation — renaming later would break every link. The
 * counter is plain and visible ("reisen-2") rather than a random suffix,
 * because a person has to read this out loud eventually.
 */
async function freeSlug(name: string): Promise<string> {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "colectivo";

  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await sql`SELECT 1 FROM collectives WHERE slug = ${candidate}`;
    if (taken.length === 0) return candidate;
  }
  // 99 collectives with the same name is not a real case, but returning a
  // duplicate slug would violate the primary key, so fall back to time.
  return `${base}-${Date.now()}`;
}
