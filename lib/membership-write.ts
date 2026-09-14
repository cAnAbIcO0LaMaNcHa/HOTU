/**
 * Membership as a conversation (tanda 3, §3).
 *
 * A membership only counts with both sides agreeing. A collective cannot
 * list somebody without permission, and a DJ cannot join without being let
 * in. Either side may start; the other answers.
 *
 *   1. the DJ applies, OR the collective invites        -> pendiente
 *   2. the other side accepts or rejects
 *   3. THE DJ chooses whether the link is casa or residente
 *   4. confirmed. Only now does the membership count.
 *
 * States are read off timestamps, not a status column:
 *
 *   pendiente  accepted_at IS NULL AND rejected_at IS NULL AND to_date IS NULL
 *   aceptada   accepted_at IS NOT NULL AND to_date IS NULL
 *   rechazada  rejected_at IS NOT NULL
 *   cerrada    to_date IS NOT NULL
 *
 * Rejection also sets to_date, so "is this link live?" is one predicate
 * everywhere — to_date IS NULL — and a rejected artist can be invited again
 * without the unique index standing in the way.
 *
 * Node-only. Never import from a client component.
 */

import { neon } from "@neondatabase/serverless";
import { canEditCollective, type MembershipKind, type WriteResult } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

export type RequestedBy = "artist" | "collective";

/**
 * A pending row always carries kind 'residente', never 'casa'.
 *
 * The DJ picks the kind at step 3, on acceptance — before that there is no
 * answer to store. 'residente' is the safe placeholder precisely because
 * it is the non-exclusive one: a pending row can never collide with the
 * one-active-casa index, so an invitation cannot be blocked by a home the
 * DJ has somewhere else.
 */
const PENDING_KIND: MembershipKind = "residente";

/** Does this email own the artist profile, i.e. speak for the DJ? */
async function isArtistOwner(artistSlug: string, email?: string | null): Promise<boolean> {
  if (!email) return false;
  const rows = await sql`SELECT owner_email FROM artists WHERE slug = ${artistSlug}`;
  const owner = rows[0]?.owner_email as string | null | undefined;
  return Boolean(owner && owner.toLowerCase() === email.toLowerCase());
}

/**
 * Opens a membership conversation.
 *
 * `requestedBy` is not taken on trust: an artist request requires the
 * caller to own the artist, a collective request requires the caller to be
 * able to edit the collective. Otherwise anyone could manufacture an
 * invitation that looks like it came from the other side.
 */
export async function requestMembership(
  collectiveSlug: string,
  artistSlug: string,
  requestedBy: RequestedBy,
  actorEmail?: string | null
): Promise<WriteResult<{ id: number }>> {
  if (requestedBy !== "artist" && requestedBy !== "collective") {
    return { ok: false, status: 400, error: "requestedBy must be 'artist' or 'collective'" };
  }

  const collective = await sql`SELECT slug, name FROM collectives WHERE slug = ${collectiveSlug}`;
  if (collective.length === 0) return { ok: false, status: 404, error: "Collective not found" };

  const artist = await sql`SELECT slug, name FROM artists WHERE slug = ${artistSlug}`;
  if (artist.length === 0) {
    return { ok: false, status: 404, error: `No existe el artista "${artistSlug}"` };
  }

  const allowed =
    requestedBy === "artist"
      ? await isArtistOwner(artistSlug, actorEmail)
      : await canEditCollective(collectiveSlug, actorEmail);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error:
        requestedBy === "artist"
          ? "Solo el dueño del perfil de artista puede postularse por él"
          : "Solo quien administra el colectivo puede invitar",
    };
  }

  const live = await sql`
    SELECT accepted_at FROM artist_collectives
    WHERE artist_slug = ${artistSlug} AND collective_slug = ${collectiveSlug} AND to_date IS NULL
  `;
  if (live.length > 0) {
    return {
      ok: false,
      status: 409,
      error: live[0].accepted_at
        ? `${artist[0].name} ya es parte de ${collective[0].name}`
        : `Ya hay una solicitud pendiente entre ${artist[0].name} y ${collective[0].name}`,
    };
  }

  const rows = await sql`
    INSERT INTO artist_collectives
      (artist_slug, collective_slug, kind, from_date, requested_by)
    VALUES (${artistSlug}, ${collectiveSlug}, ${PENDING_KIND}, CURRENT_DATE, ${requestedBy})
    RETURNING id
  `;
  return { ok: true, value: { id: rows[0].id as number } };
}

/** Loads a pending row plus who is allowed to answer it. */
async function loadPending(id: number) {
  const rows = await sql`
    SELECT ac.*, a.name AS artist_name, c.name AS collective_name
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.id = ${id}
  `;
  return rows[0];
}

/**
 * Accepts a pending membership, and — when the DJ is the one accepting —
 * records the kind they chose.
 *
 * WHO ANSWERS is the mirror of who asked: a collective's invitation is
 * answered by the artist, an artist's application by the collective.
 * Letting the asker also answer would make the whole handshake decorative.
 *
 * `kind` only means something coming from the artist's side. The spec is
 * explicit that the DJ chooses. When a collective accepts an application,
 * the link stays 'residente' and the DJ sets it afterwards with chooseKind.
 *
 * Asking for 'casa' while already having one does NOT move anything. It
 * comes back as a conflict carrying the options, the row stays pending,
 * and resolveCasa applies whatever the DJ then picks. Closing someone's
 * home is never a side effect of another request.
 */
export async function acceptMembership(
  id: number,
  kind: MembershipKind | undefined,
  actorEmail?: string | null
): Promise<
  WriteResult<
    { kind: MembershipKind; needsKindChoice: boolean } | CasaConflict
  >
> {
  const row = await loadPending(id);
  if (!row) return { ok: false, status: 404, error: "Esa solicitud no existe" };
  if (row.to_date) return { ok: false, status: 409, error: "Esa solicitud ya está cerrada" };
  if (row.accepted_at) return { ok: false, status: 409, error: "Esa solicitud ya fue aceptada" };
  if (row.rejected_at) return { ok: false, status: 409, error: "Esa solicitud ya fue rechazada" };

  const artistAnswers = row.requested_by === "collective";
  const allowed = artistAnswers
    ? await isArtistOwner(row.artist_slug as string, actorEmail)
    : await canEditCollective(row.collective_slug as string, actorEmail);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: artistAnswers
        ? "Esta invitación la responde el DJ"
        : "Esta postulación la responde el colectivo",
    };
  }

  // Only the artist gets to pick, and only at their own acceptance.
  if (!artistAnswers) {
    await sql`UPDATE artist_collectives SET accepted_at = now() WHERE id = ${id}`;
    return { ok: true, value: { kind: PENDING_KIND, needsKindChoice: true } };
  }

  const chosen: MembershipKind = kind === "casa" ? "casa" : "residente";
  if (chosen === "residente") {
    await sql`UPDATE artist_collectives SET accepted_at = now(), kind = 'residente' WHERE id = ${id}`;
    return { ok: true, value: { kind: "residente", needsKindChoice: false } };
  }

  // They asked for casa. If one already exists, hand back the options and
  // leave the row pending — the DJ has to say which way explicitly.
  const conflict = await casaConflict(
    row.artist_slug as string,
    id,
    row.collective_slug as string,
    row.collective_name as string
  );
  if (conflict) return { ok: true, value: conflict };

  await sql`UPDATE artist_collectives SET accepted_at = now(), kind = 'casa' WHERE id = ${id}`;
  return { ok: true, value: { kind: "casa", needsKindChoice: false } };
}

/**
 * The DJ's explicit answer to a casa conflict, and the only path that ever
 * closes a previous home.
 *
 * Works for a row that is still pending (accepting and deciding in one go)
 * and for one already accepted (just changing the link), because the DJ
 * reaches this from both places and the decision means the same thing.
 */
export async function resolveCasa(
  id: number,
  choice: CasaDecision,
  actorEmail?: string | null
): Promise<WriteResult> {
  if (choice?.decision !== "keep" && choice?.decision !== "move") {
    return { ok: false, status: 400, error: "decision must be 'keep' or 'move'" };
  }
  if (choice.decision === "move" && choice.previous !== "stay" && choice.previous !== "leave") {
    return {
      ok: false,
      status: 400,
      error: "Al mover la casa hay que decir qué pasa con la anterior: 'stay' o 'leave'",
    };
  }

  const row = await loadPending(id);
  if (!row) return { ok: false, status: 404, error: "Ese vínculo no existe" };
  if (row.to_date) return { ok: false, status: 409, error: "Ese vínculo está cerrado" };
  if (row.rejected_at) return { ok: false, status: 409, error: "Esa solicitud fue rechazada" };
  if (!(await isArtistOwner(row.artist_slug as string, actorEmail))) {
    return { ok: false, status: 403, error: "Solo el DJ decide dónde está su casa" };
  }

  // Still pending means this call also accepts it.
  const alsoAccept = !row.accepted_at;
  if (alsoAccept && row.requested_by !== "collective") {
    return {
      ok: false,
      status: 409,
      error: "Esa postulación todavía no fue aceptada por el colectivo",
    };
  }

  return await applyCasaDecision(row.artist_slug as string, id, choice, alsoAccept);
}

/** The home the artist holds right now, if any. */
async function currentCasa(artistSlug: string, exceptId: number) {
  const rows = await sql`
    SELECT ac.id, ac.collective_slug, c.name
    FROM artist_collectives ac
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.artist_slug = ${artistSlug} AND ac.kind = 'casa'
      AND ac.to_date IS NULL AND ac.id <> ${exceptId}
  `;
  return rows[0];
}

/**
 * Returned instead of acting when the DJ asks for 'casa' and already has
 * one. The endpoint's job at that point is to lay out the options, not to
 * pick one — see resolveCasa.
 */
export type CasaConflict = {
  conflict: "casa";
  current: { slug: string; name: string };
  target: { slug: string; name: string };
  options: Array<{ decision: "keep" } | { decision: "move"; previous: "stay" | "leave" }>;
};

export type CasaDecision =
  | { decision: "keep" }
  | { decision: "move"; previous: "stay" | "leave" };

/**
 * Applies a casa decision the DJ made EXPLICITLY.
 *
 * Nothing here runs off the back of a plain "kind: casa" request. Closing
 * somebody's home is not an implementation detail of changing a field, and
 * the previous collective is not ours to leave on their behalf — §3.1 says
 * the DJ picks between staying there as residente and walking out, and
 * until they say which, neither happens.
 *
 * Every branch that writes does so in ONE transaction. Halfway through a
 * move the artist would hold two active casas, which the unique index
 * refuses, so the ordering is not a preference — it is the only order that
 * works at all.
 */
async function applyCasaDecision(
  artistSlug: string,
  id: number,
  choice: CasaDecision,
  alsoAccept: boolean
): Promise<WriteResult> {
  const current = await currentCasa(artistSlug, id);

  // "keep": the home stays where it is and this link is a residencia.
  if (choice.decision === "keep") {
    if (alsoAccept) {
      await sql`UPDATE artist_collectives SET accepted_at = now(), kind = 'residente' WHERE id = ${id}`;
    } else {
      await sql`UPDATE artist_collectives SET kind = 'residente' WHERE id = ${id}`;
    }
    return { ok: true, value: undefined };
  }

  if (!current) {
    // The conflict evaporated between the two calls — somebody closed the
    // old home meanwhile. Nothing to move; just take the new one.
    if (alsoAccept) {
      await sql`UPDATE artist_collectives SET accepted_at = now(), kind = 'casa' WHERE id = ${id}`;
    } else {
      await sql`UPDATE artist_collectives SET kind = 'casa' WHERE id = ${id}`;
    }
    return { ok: true, value: undefined };
  }

  const oldId = current.id as number;
  const oldCollective = current.collective_slug as string;

  const steps = [sql`UPDATE artist_collectives SET to_date = CURRENT_DATE WHERE id = ${oldId}`];

  // "stay" keeps the link to the old collective, demoted. "leave" closes
  // it outright — which is why it has to be asked for, never assumed.
  if (choice.previous === "stay") {
    steps.push(sql`
      INSERT INTO artist_collectives
        (artist_slug, collective_slug, kind, from_date, accepted_at, requested_by)
      VALUES (${artistSlug}, ${oldCollective}, 'residente', CURRENT_DATE, now(), 'artist')
    `);
  }

  steps.push(
    alsoAccept
      ? sql`UPDATE artist_collectives SET accepted_at = now(), kind = 'casa' WHERE id = ${id}`
      : sql`UPDATE artist_collectives SET kind = 'casa' WHERE id = ${id}`
  );

  await sql.transaction(steps);
  return { ok: true, value: undefined };
}

/** Builds the options payload for a home the DJ already has. */
async function casaConflict(
  artistSlug: string,
  id: number,
  targetSlug: string,
  targetName: string
): Promise<CasaConflict | null> {
  const current = await currentCasa(artistSlug, id);
  if (!current) return null;
  return {
    conflict: "casa",
    current: { slug: current.collective_slug as string, name: current.name as string },
    target: { slug: targetSlug, name: targetName },
    options: [
      { decision: "keep" },
      { decision: "move", previous: "stay" },
      { decision: "move", previous: "leave" },
    ],
  };
}

/**
 * The DJ changes their mind about an accepted link, or sets the kind after
 * a collective accepted their application. Only the artist decides.
 *
 * Same rule as accepting: asking for 'casa' with one already in place
 * returns the options rather than acting on them.
 */
export async function chooseKind(
  id: number,
  kind: MembershipKind,
  actorEmail?: string | null
): Promise<WriteResult<undefined | CasaConflict>> {
  if (kind !== "casa" && kind !== "residente") {
    return { ok: false, status: 400, error: "kind must be 'casa' or 'residente'" };
  }

  const row = await loadPending(id);
  if (!row) return { ok: false, status: 404, error: "Ese vínculo no existe" };
  if (row.to_date) return { ok: false, status: 409, error: "Ese vínculo está cerrado" };
  if (!row.accepted_at) {
    return { ok: false, status: 409, error: "Ese vínculo todavía no fue aceptado" };
  }
  if (!(await isArtistOwner(row.artist_slug as string, actorEmail))) {
    return { ok: false, status: 403, error: "Solo el DJ elige si un colectivo es su casa" };
  }
  if (row.kind === kind) return { ok: true, value: undefined };

  if (kind === "residente") {
    await sql`UPDATE artist_collectives SET kind = 'residente' WHERE id = ${id}`;
    return { ok: true, value: undefined };
  }

  const conflict = await casaConflict(
    row.artist_slug as string,
    id,
    row.collective_slug as string,
    row.collective_name as string
  );
  if (conflict) return { ok: true, value: conflict };

  await sql`UPDATE artist_collectives SET kind = 'casa' WHERE id = ${id}`;
  return { ok: true, value: undefined };
}

/**
 * Withdraws a pending request — the side that OPENED it changing its mind.
 *
 * Recorded as canceled_at, not rejected_at: "me arrepentí" and "me
 * dijeron que no" are different events, and the history should not
 * flatten them into one. Closes the row so the pair can start over.
 */
export async function cancelMembership(
  id: number,
  actorEmail?: string | null
): Promise<WriteResult> {
  const row = await loadPending(id);
  if (!row) return { ok: false, status: 404, error: "Esa solicitud no existe" };
  if (row.to_date) return { ok: false, status: 409, error: "Esa solicitud ya está cerrada" };
  if (row.accepted_at) {
    return {
      ok: false,
      status: 409,
      error: "Esa solicitud ya fue aceptada: para deshacerla hay que cerrar el vínculo",
    };
  }

  // Only whoever started it can withdraw it. The other side rejects.
  const startedByArtist = row.requested_by === "artist";
  const allowed = startedByArtist
    ? await isArtistOwner(row.artist_slug as string, actorEmail)
    : await canEditCollective(row.collective_slug as string, actorEmail);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: startedByArtist
        ? "Solo el DJ puede retirar su postulación"
        : "Solo el colectivo puede retirar su invitación",
    };
  }

  await sql`
    UPDATE artist_collectives
    SET canceled_at = now(), to_date = CURRENT_DATE
    WHERE id = ${id}
  `;
  return { ok: true, value: undefined };
}

/**
 * Rejects a pending membership. Sets rejected_at AND to_date: the row stops
 * being live, so the unique index frees up and the same pair can try again
 * later. The history of the refusal stays.
 */
export async function rejectMembership(
  id: number,
  actorEmail?: string | null
): Promise<WriteResult> {
  const row = await loadPending(id);
  if (!row) return { ok: false, status: 404, error: "Esa solicitud no existe" };
  if (row.to_date) return { ok: false, status: 409, error: "Esa solicitud ya está cerrada" };
  if (row.accepted_at) return { ok: false, status: 409, error: "Esa solicitud ya fue aceptada" };

  const artistAnswers = row.requested_by === "collective";
  const allowed = artistAnswers
    ? await isArtistOwner(row.artist_slug as string, actorEmail)
    : await canEditCollective(row.collective_slug as string, actorEmail);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: artistAnswers
        ? "Esta invitación la responde el DJ"
        : "Esta postulación la responde el colectivo",
    };
  }

  await sql`
    UPDATE artist_collectives
    SET rejected_at = now(), to_date = CURRENT_DATE
    WHERE id = ${id}
  `;
  return { ok: true, value: undefined };
}
