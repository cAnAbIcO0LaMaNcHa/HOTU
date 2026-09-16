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
// Solo el tipo: import type se borra al compilar, así que no arrastra la
// conexión de lib/db.ts a ningún lado.
import type { EntityKind } from "./db";
import { validateGenreSelection, type GenreSelectionOk } from "./genres-write";

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
  patch: { name?: unknown; bio?: unknown; sector?: unknown; address?: unknown; capacity?: unknown },
  email?: string | null
): Promise<WriteResult<{ updated: string[] }>> {
  if (!(await canEditCollective(slug, email))) {
    return { ok: false, status: 403, error: "No podés editar este colectivo" };
  }

  const updated: string[] = [];

  // address y capacity son de venues. Se aceptan solo si la fila LO ES:
  // un colectivo no tiene dirección propia ni aforo, y dejar que los
  // guarde igual llenaría la tabla de datos que nada muestra y que el
  // día que alguien los lea van a estar mal.
  const necesitaVenue = patch.address !== undefined || patch.capacity !== undefined;
  let esVenue = false;
  if (necesitaVenue) {
    const filas = await sql`SELECT entity_kind FROM collectives WHERE slug = ${slug}`;
    esVenue = filas[0]?.entity_kind === "venue";
    if (!esVenue) {
      return {
        ok: false,
        status: 400,
        error: "La dirección y el aforo son de un venue, no de un colectivo",
      };
    }
  }

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

  if (patch.address !== undefined) {
    if (typeof patch.address !== "string") {
      return { ok: false, status: 400, error: "La dirección tiene que ser texto" };
    }
    const address = patch.address.trim().slice(0, 200);
    await sql`UPDATE collectives SET address = ${address || null} WHERE slug = ${slug}`;
    updated.push("address");
  }

  if (patch.capacity !== undefined) {
    // Vacío borra el aforo; cualquier otra cosa tiene que ser un entero
    // positivo. El CHECK de la base rechaza 0 y negativos igual, pero un
    // mensaje entendible es mejor que una violación de constraint.
    const crudo = patch.capacity;
    let capacity: number | null = null;
    if (crudo !== null && crudo !== "") {
      const n = Number(crudo);
      if (!Number.isInteger(n) || n <= 0) {
        return { ok: false, status: 400, error: "El aforo tiene que ser un número entero mayor que cero" };
      }
      capacity = n;
    }
    await sql`UPDATE collectives SET capacity = ${capacity} WHERE slug = ${slug}`;
    updated.push("capacity");
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
  email: string,
  /**
   * Colectivo o venue. Los dos nacen igual: de una cuenta de DJ, uno por
   * cuenta, con el fundador como dueño y primer miembro (§4.1 y §5).
   *
   * Lo único que cambia es el tipo y, con él, el vínculo: en un colectivo
   * el fundador entra como casa si no tiene otra; en un VENUE entra
   * siempre como residente, porque un venue no es la casa de nadie.
   */
  entityKind: EntityKind = "collective",
  /** El género, obligatorio para un colectivo e ignorado para un venue. */
  selection?: {
    primaryBranch?: unknown;
    secondaryBranches?: unknown;
    tags?: unknown;
  }
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
    SELECT slug, name, city FROM artists
    WHERE lower(owner_email) = lower(${email}) AND status = 'published'
    ORDER BY slug LIMIT 1
  `;
  const etiqueta = entityKind === "venue" ? "venue" : "colectivo";

  if (!artist) {
    return {
      ok: false,
      status: 403,
      error: `Necesitás un perfil de DJ para crear un ${etiqueta}`,
    };
  }

  // El "uno por cuenta" cuenta SOLO el mismo tipo.
  //
  // Sin el filtro, tener un venue te negaría el colectivo con un mensaje
  // falso ("ya tenés un colectivo") y viceversa, y los seis dueños de
  // colectivo que ya existen no podrían abrir un venue nunca. Es el tipo
  // de bug que no se nota al escribirlo porque hoy no hay ningún venue:
  // aparece entero el día que existe el primero.
  const owned = await sql`
    SELECT slug FROM collectives
    WHERE lower(owner_email) = lower(${email}) AND entity_kind = ${entityKind}
  `;
  if (owned.length > 0) {
    return { ok: false, status: 409, error: `Ya tenés un ${etiqueta}. Es uno por cuenta.` };
  }

  /**
   * El género es OBLIGATORIO para un colectivo, igual que para un
   * artista (§2.3). No para un venue: un lugar no tiene género propio,
   * lo tiene la fiesta que pasa adentro.
   *
   * Se valida con validateGenreSelection, la misma función que usan el
   * alta de artista y la edición de los dos. Tres caminos, una regla.
   */
  let genero: GenreSelectionOk | null = null;
  if (entityKind === "collective") {
    const v = await validateGenreSelection({
      primaryBranch: String(selection?.primaryBranch ?? ""),
      secondaryBranches: Array.isArray(selection?.secondaryBranches)
        ? (selection.secondaryBranches as unknown[]).map(String)
        : [],
      tags: Array.isArray(selection?.tags)
        ? (selection.tags as Array<Record<string, unknown>>).map((t) => ({
            slug: String(t?.slug ?? ""),
            branchCode: String(t?.branchCode ?? ""),
          }))
        : [],
    });
    if (!v.ok) return v;
    genero = v.value;
  }

  const slug = await freeSlug(clean);

  // La ciudad del fundador siembra la del colectivo: el crew arranca
  // donde está quien lo funda, y después se edita.
  //
  // El distrito ya no se copia del fundador (tanda 4 §3): eso propagaba
  // el D00 que todo DJ nuevo hereda del DEFAULT. Va un literal congelado
  // en vez de omitirse, para no depender de que main tenga el mismo
  // DEFAULT que dev — no hay forma de consultar main desde acá, y si no
  // lo tuviera esto sería un not-null en producción.
  await sql`
    INSERT INTO collectives (slug, name, type, sector, bio, district, owner_email, status, entity_kind)
    VALUES (${slug}, ${clean}, 'LOCAL', ${artist.city ?? "Bogotá"}, '',
            'D00', ${email}, 'published', ${entityKind})
  `;

  if (genero) {
    await sql.transaction([
      sql`
        INSERT INTO collective_genres (collective_slug, branch_code, is_primary, sort_order)
        VALUES (${slug}, ${genero.primary}, true, 0)
      `,
      ...genero.secundarios.map(
        (c, i) => sql`
          INSERT INTO collective_genres (collective_slug, branch_code, is_primary, sort_order)
          VALUES (${slug}, ${c}, false, ${i + 1})
        `
      ),
      ...genero.tagsUnicos.map(
        (t, i) => sql`
          INSERT INTO collective_genre_tags (collective_slug, tag_slug, branch_code, sort_order)
          VALUES (${slug}, ${t.slug}, ${t.branchCode}, ${i})
        `
      ),
    ]);
  }

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
  // En un venue el fundador entra como residente SIEMPRE, tenga casa o
  // no: un venue no es la casa de nadie, ni siquiera de quien lo abrió.
  const kind: MembershipKind =
    entityKind === "venue" ? "residente" : casa ? "residente" : "casa";

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
