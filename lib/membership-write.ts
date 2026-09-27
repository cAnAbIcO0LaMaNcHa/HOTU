/**
 * Membership as a conversation (tanda 3, §3).
 *
 * A membership only counts with both sides agreeing. A collective cannot
 * list somebody without permission, and a DJ cannot join without being let
 * in. Either side may start; the other answers.
 *
 *   1. the DJ applies, OR the collective invites        -> pendiente
 *   2. the other side accepts or rejects
 *   3. THE DJ chooses whether the link is casa or miembro
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
import {
  puedeAdministrarColectivo,
  type MembershipKind,
  type WriteResult,
} from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

export type RequestedBy = "artist" | "collective";

/**
 * A pending row always carries kind 'miembro', never 'residente'.
 *
 * The DJ picks the kind at step 3, on acceptance — before that there is no
 * answer to store. 'miembro' is the safe placeholder precisely because
 * it is the non-exclusive one: a pending row can never collide with the
 * one-active-casa index, so an invitation cannot be blocked by a home the
 * DJ has somewhere else.
 */
const PENDING_KIND: MembershipKind = "miembro";

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
      : await puedeAdministrarColectivo(collectiveSlug, actorEmail);
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
    SELECT ac.*, a.name AS artist_name, c.name AS collective_name,
           c.entity_kind AS collective_entity_kind
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.id = ${id}
  `;
  return rows[0];
}

/*
 * rechazarCasaEnVenue SE MUDÓ, no se dejó sin uso.
 *
 * Vive en lib/residency-offers-write.ts como rechazarResidenciaEnVenue, porque
 * ahí está ahora el único camino que puede escribir kind='residente' y una
 * guarda vale donde está la escritura. Borrada y no dejada acá por lo mismo que
 * recalcMembership y addMember: una función que sigue existiendo es una función
 * que alguien vuelve a llamar, y esta llamada desde este archivo ya no querría
 * decir nada.
 *
 * loadPending sigue trayendo collective_entity_kind. Queda a propósito: es la
 * columna que decide si una residencia es posible, y el día que algo de acá
 * vuelva a necesitarla, que esté.
 */


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
 * the link stays 'miembro' and the DJ sets it afterwards with chooseKind.
 *
 * Asking for 'residente' while already having one does NOT move anything. It
 * comes back as a conflict carrying the options, the row stays pending,
 * and resolverResidencia applies whatever the DJ then picks. Closing someone's
 * home is never a side effect of another request.
 */
export async function acceptMembership(
  id: number,
  kind: MembershipKind | undefined,
  actorEmail?: string | null
): Promise<WriteResult<{ kind: MembershipKind; needsKindChoice: boolean }>> {
  const row = await loadPending(id);
  if (!row) return { ok: false, status: 404, error: "Esa solicitud no existe" };
  if (row.to_date) return { ok: false, status: 409, error: "Esa solicitud ya está cerrada" };
  if (row.accepted_at) return { ok: false, status: 409, error: "Esa solicitud ya fue aceptada" };
  if (row.rejected_at) return { ok: false, status: 409, error: "Esa solicitud ya fue rechazada" };

  const artistAnswers = row.requested_by === "collective";
  const allowed = artistAnswers
    ? await isArtistOwner(row.artist_slug as string, actorEmail)
    : await puedeAdministrarColectivo(row.collective_slug as string, actorEmail);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: artistAnswers
        ? "Esta invitación la responde el DJ"
        : "Esta postulación la responde el colectivo",
    };
  }

  /**
   * ACEPTAR UNA MEMBRESÍA SIEMPRE DA 'miembro', VENGA DE DONDE VENGA.
   *
   * Antes de la fase 2 el DJ elegía acá mismo si el vínculo era su núcleo. Ya
   * no: 'residente' es permiso de edición, y un permiso no se toma, se
   * concede. El dueño lo ofrece por residency_offers y el DJ responde ahí.
   *
   * Un kind:'residente' en el body se RECHAZA en vez de ignorarse. Ignorarlo
   * devolvería 200 diciendo "listo" con el DJ convencido de que quedó
   * residente, y la diferencia recién aparecería al intentar editar. Un error
   * que explica dónde está la puerta es mejor que un éxito que miente.
   */
  if (kind === "residente") {
    return {
      ok: false,
      status: 403,
      error:
        "La residencia no se elige al aceptar: la ofrece quien administra el colectivo y " +
        "después la aceptás. Esto te suma como miembro.",
    };
  }

  await sql`UPDATE artist_collectives SET accepted_at = now(), kind = 'miembro' WHERE id = ${id}`;
  return { ok: true, value: { kind: PENDING_KIND, needsKindChoice: false } };
}

/**
 * EL DJ CAMBIA EL TIPO DE UN VÍNCULO YA ACEPTADO — Y LA PUERTA ESTÁ INVERTIDA.
 *
 * ============================================================
 * BAJAR SÍ, SUBIR NO
 * ============================================================
 *
 * Hasta la fase 2 esta función iba en los dos sentidos, y solo pedía
 * isArtistOwner. Su mensaje lo decía entero: "Solo el DJ elige si un colectivo
 * es su casa". Con 'residente' de etiqueta, eso era correcto.
 *
 * Con 'residente' de PERMISO DE EDICIÓN, ese mismo camino es una escalada de
 * privilegios: cualquier miembro de cualquier colectivo llamaba acá y salía
 * con permiso de editar un perfil ajeno, sin que el dueño se enterara. El
 * renombre solo no la habría tocado —la palabra queda igual, el poder cambia—,
 * y por eso la inversión va en el mismo tramo que el renombre y no después.
 *
 * Entonces:
 *
 *   'miembro'   — SIEMPRE se puede. Es RENUNCIAR, y nadie necesita permiso
 *                 para dejar de tener un permiso. Vale incluso en un venue,
 *                 porque miembro es justamente lo único que un venue admite.
 *   'residente' — NUNCA por acá. Se concede: el dueño ofrece por
 *                 residency_offers y el DJ responde. Ver lib/residency-offers-write.ts.
 *
 * La asimetría es el punto. Un permiso se toma con el consentimiento de quien
 * lo da, y se suelta con el de quien lo tiene.
 */
export async function chooseKind(
  id: number,
  kind: MembershipKind,
  actorEmail?: string | null
): Promise<WriteResult> {
  if (kind !== "residente" && kind !== "miembro") {
    return { ok: false, status: 400, error: "kind must be 'residente' or 'miembro'" };
  }

  const row = await loadPending(id);
  if (!row) return { ok: false, status: 404, error: "Ese vínculo no existe" };
  if (row.to_date) return { ok: false, status: 409, error: "Ese vínculo está cerrado" };
  if (!row.accepted_at) {
    return { ok: false, status: 409, error: "Ese vínculo todavía no fue aceptado" };
  }
  if (!(await isArtistOwner(row.artist_slug as string, actorEmail))) {
    return { ok: false, status: 403, error: "Solo el DJ decide sobre sus propios vínculos" };
  }

  /**
   * EL RECHAZO VA ANTES DEL no-op DE row.kind === kind, Y NO ES INDIFERENTE.
   *
   * Con el orden al revés, un residente pidiendo 'residente' recibiría 200 y
   * un miembro pidiendo lo mismo recibiría 403 — la misma llamada contestando
   * distinto según lo que el llamador ya tenga. Eso es un oráculo: sirve para
   * averiguar quién es residente de qué sin poder verlo. Un 403 para todos no
   * dice nada de nadie.
   */
  if (kind === "residente") {
    return {
      ok: false,
      status: 403,
      error:
        "La residencia no se elige: la ofrece quien administra el colectivo y vos la aceptás. " +
        "Por acá solo podés dejarla.",
    };
  }

  if (row.kind === kind) return { ok: true, value: undefined };

  await sql`UPDATE artist_collectives SET kind = 'miembro' WHERE id = ${id}`;
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
    : await puedeAdministrarColectivo(row.collective_slug as string, actorEmail);
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
    : await puedeAdministrarColectivo(row.collective_slug as string, actorEmail);
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
