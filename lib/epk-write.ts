/**
 * Row-level writes for the EPK's list sections: DJ SETS, TRACKS and the
 * declared gigs behind the EVENTS carousel.
 *
 * Per the repo rule the work lives here and app/api/artists/[slug]/* exposes
 * it over HTTP, so the mobile app calls the same endpoints. Nothing here
 * touches a Next request context — the caller passes the acting email in.
 *
 * Node-only. Never import from a client component.
 */

import { neon } from "@neondatabase/serverless";
import { canEditArtist } from "./artists-write";

const sql = neon(process.env.DATABASE_URL!);

export type WriteResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const MAX_TITLE = 160;
const MAX_SHORT = 80;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  return cleanText(value, max);
}

/** Same rule as the profile: only http(s) ever reaches an href. */
function cleanUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

/** YYYY-MM-DD, and a date that actually exists — "2026-02-31" is rejected. */
function cleanDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

/**
 * The combining-accent block, U+0300 to U+036F. Built from char codes
 * rather than written into a regex literal so the range cannot be mangled
 * by a re-encoding of this file — after normalize("NFD") an "á" is "a"
 * plus one of these marks, and stripping them is what turns "Bogotá" into
 * "bogota" instead of "bogot-".
 */
const COMBINING_MARKS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g"
);

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * dj_sets and tracks are keyed by a text slug, so a new row needs one that
 * is free. Prefixing with the artist keeps two DJs' "Live Set" apart, and
 * the numeric suffix handles the same artist reusing a title.
 */
async function uniqueSlug(
  table: "dj_sets" | "tracks",
  artistSlug: string,
  title: string
): Promise<string | null> {
  const base = `${artistSlug}-${slugify(title)}`.slice(0, 70) || artistSlug;
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const rows =
      table === "dj_sets"
        ? await sql`SELECT 1 FROM dj_sets WHERE slug = ${candidate}`
        : await sql`SELECT 1 FROM tracks WHERE slug = ${candidate}`;
    if (rows.length === 0) return candidate;
  }
  return null;
}

/** Loads the artist's name and district, which new rows inherit. */
async function loadArtist(slug: string) {
  const rows = await sql`SELECT slug, name, district FROM artists WHERE slug = ${slug}`;
  return rows[0] as { slug: string; name: string; district: string } | undefined;
}

async function authorize(
  artistSlug: string,
  actorEmail?: string | null
): Promise<WriteResult<{ name: string; district: string }>> {
  const artist = await loadArtist(artistSlug);
  if (!artist) return { ok: false, status: 404, error: "Artist not found" };
  if (!(await canEditArtist(artistSlug, actorEmail))) {
    return { ok: false, status: 403, error: "Not allowed to edit this profile" };
  }
  return { ok: true, value: { name: artist.name, district: artist.district } };
}

// -----------------------------------------------------------------
// DJ SETS
// -----------------------------------------------------------------

export type NewSetInput = {
  title?: unknown;
  duration?: unknown;
  recordedAt?: unknown;
  url?: unknown;
};

export async function createSet(
  artistSlug: string,
  input: NewSetInput,
  actorEmail?: string | null
): Promise<WriteResult<{ slug: string }>> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const title = cleanText(input.title, MAX_TITLE);
  if (!title) return { ok: false, status: 400, error: "title is required" };

  const duration = optionalText(input.duration, 20) ?? "";
  const recordedAt = cleanDate(input.recordedAt);
  if (!recordedAt) {
    return { ok: false, status: 400, error: "recordedAt must be a real YYYY-MM-DD date" };
  }

  const url = cleanUrl(input.url);
  if (url === undefined) return { ok: false, status: 400, error: "url must be an http(s) URL" };

  const slug = await uniqueSlug("dj_sets", artistSlug, title);
  if (!slug) return { ok: false, status: 409, error: "Could not allocate a slug for this title" };

  // duration is NOT NULL; an empty box stores "" rather than failing.
  await sql`
    INSERT INTO dj_sets
      (slug, title, artist_name, artist_slug, district, duration, recorded_at, url, status)
    VALUES
      (${slug}, ${title}, ${auth.value.name}, ${artistSlug}, ${auth.value.district},
       ${duration}, ${recordedAt}::date, ${url ?? "#"}, 'published')
  `;
  return { ok: true, value: { slug } };
}

/** Every field of an existing set the owner may change. */
export type SetPatch = {
  title?: unknown;
  duration?: unknown;
  recordedAt?: unknown;
  url?: unknown;
  coverUrl?: unknown;
  sortOrder?: unknown;
};

/**
 * Shared by both PATCHes: turns a loosely-typed patch into column values,
 * or returns the first validation failure.
 *
 * An absent key means "leave alone" and an explicit null means "clear", so
 * a form that only edits the cover cannot blank the title it never sent.
 */
function buildRowPatch(
  patch: Record<string, unknown>,
  dateKey: "recordedAt" | "releasedAt"
): { values: Record<string, string | number | null> } | { error: string } {
  const values: Record<string, string | number | null> = {};

  if (patch.title !== undefined) {
    const title = cleanText(patch.title, MAX_TITLE);
    if (!title) return { error: "title cannot be empty" };
    values.title = title;
  }

  if (patch[dateKey] !== undefined) {
    const date = cleanDate(patch[dateKey]);
    if (!date) return { error: `${dateKey} must be a real YYYY-MM-DD date` };
    values.date = date;
  }

  if (patch.url !== undefined) {
    const url = cleanUrl(patch.url);
    if (url === undefined) return { error: "url must be an http(s) URL" };
    // url is NOT NULL in both tables; clearing it falls back to the
    // placeholder the rest of the app already treats as "no link".
    values.url = url ?? "#";
  }

  if (patch.coverUrl !== undefined) {
    const cover = cleanUrl(patch.coverUrl);
    if (cover === undefined) return { error: "coverUrl must be an http(s) URL" };
    values.coverUrl = cover;
  }

  if (patch.duration !== undefined) {
    values.duration = optionalText(patch.duration, 20) ?? "";
  }

  if (patch.label !== undefined) {
    values.label = optionalText(patch.label, MAX_SHORT);
  }

  if (patch.sortOrder !== undefined) {
    if (patch.sortOrder === null || patch.sortOrder === "") {
      values.sortOrder = null;
    } else {
      const n = Number(patch.sortOrder);
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        return { error: "sortOrder must be a whole number between 0 and 9999" };
      }
      values.sortOrder = n;
    }
  }

  return { values };
}

export async function updateSet(
  artistSlug: string,
  setSlug: string,
  patch: SetPatch,
  actorEmail?: string | null
): Promise<WriteResult> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const built = buildRowPatch(patch as Record<string, unknown>, "recordedAt");
  if ("error" in built) return { ok: false, status: 400, error: built.error };
  const { values } = built;
  if (Object.keys(values).length === 0) {
    return { ok: false, status: 400, error: "Nothing to update" };
  }

  // Scoped by artist_slug for the same reason the deletes are: the
  // ownership check says which profile you may edit, and this says the row
  // actually belongs to it.
  const rows = await sql`
    UPDATE dj_sets SET
      title       = COALESCE(${values.title ?? null}, title),
      recorded_at = COALESCE(${values.date ?? null}::date, recorded_at),
      url         = COALESCE(${values.url ?? null}, url),
      duration    = COALESCE(${values.duration ?? null}, duration),
      cover_url   = CASE WHEN ${"coverUrl" in values} THEN ${values.coverUrl ?? null}::text ELSE cover_url END,
      sort_order  = CASE WHEN ${"sortOrder" in values} THEN ${values.sortOrder ?? null}::integer ELSE sort_order END
    WHERE slug = ${setSlug} AND artist_slug = ${artistSlug}
    RETURNING slug
  `;
  if (rows.length === 0) return { ok: false, status: 404, error: "Set not found on this profile" };
  return { ok: true, value: undefined };
}

export type TrackPatch = {
  title?: unknown;
  releasedAt?: unknown;
  url?: unknown;
  coverUrl?: unknown;
  label?: unknown;
  sortOrder?: unknown;
};

export async function updateTrack(
  artistSlug: string,
  trackSlug: string,
  patch: TrackPatch,
  actorEmail?: string | null
): Promise<WriteResult> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const built = buildRowPatch(patch as Record<string, unknown>, "releasedAt");
  if ("error" in built) return { ok: false, status: 400, error: built.error };
  const { values } = built;
  if (Object.keys(values).length === 0) {
    return { ok: false, status: 400, error: "Nothing to update" };
  }

  const rows = await sql`
    UPDATE tracks SET
      title       = COALESCE(${values.title ?? null}, title),
      released_at = COALESCE(${values.date ?? null}::date, released_at),
      url         = COALESCE(${values.url ?? null}, url),
      cover_url   = CASE WHEN ${"coverUrl" in values} THEN ${values.coverUrl ?? null}::text ELSE cover_url END,
      label       = CASE WHEN ${"label" in values} THEN ${values.label ?? null}::text ELSE label END,
      sort_order  = CASE WHEN ${"sortOrder" in values} THEN ${values.sortOrder ?? null}::integer ELSE sort_order END
    WHERE slug = ${trackSlug} AND artist_slug = ${artistSlug}
    RETURNING slug
  `;
  if (rows.length === 0) return { ok: false, status: 404, error: "Track not found on this profile" };
  return { ok: true, value: undefined };
}

export async function deleteSet(
  artistSlug: string,
  setSlug: string,
  actorEmail?: string | null
): Promise<WriteResult> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  // Scoped to the artist on purpose: without the artist_slug condition an
  // owner could delete another DJ's set by guessing its slug.
  const rows = await sql`
    DELETE FROM dj_sets WHERE slug = ${setSlug} AND artist_slug = ${artistSlug} RETURNING slug
  `;
  if (rows.length === 0) return { ok: false, status: 404, error: "Set not found on this profile" };
  return { ok: true, value: undefined };
}

// -----------------------------------------------------------------
// TRACKS
// -----------------------------------------------------------------

export type NewTrackInput = {
  title?: unknown;
  releasedAt?: unknown;
  url?: unknown;
};

export async function createTrack(
  artistSlug: string,
  input: NewTrackInput,
  actorEmail?: string | null
): Promise<WriteResult<{ slug: string }>> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const title = cleanText(input.title, MAX_TITLE);
  if (!title) return { ok: false, status: 400, error: "title is required" };

  const releasedAt = cleanDate(input.releasedAt);
  if (!releasedAt) {
    return { ok: false, status: 400, error: "releasedAt must be a real YYYY-MM-DD date" };
  }

  const url = cleanUrl(input.url);
  if (url === undefined) return { ok: false, status: 400, error: "url must be an http(s) URL" };

  const slug = await uniqueSlug("tracks", artistSlug, title);
  if (!slug) return { ok: false, status: 409, error: "Could not allocate a slug for this title" };

  await sql`
    INSERT INTO tracks
      (slug, title, artist_name, artist_slug, district, released_at, url, status)
    VALUES
      (${slug}, ${title}, ${auth.value.name}, ${artistSlug}, ${auth.value.district},
       ${releasedAt}::date, ${url ?? "#"}, 'published')
  `;
  return { ok: true, value: { slug } };
}

export async function deleteTrack(
  artistSlug: string,
  trackSlug: string,
  actorEmail?: string | null
): Promise<WriteResult> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const rows = await sql`
    DELETE FROM tracks WHERE slug = ${trackSlug} AND artist_slug = ${artistSlug} RETURNING slug
  `;
  if (rows.length === 0) return { ok: false, status: 404, error: "Track not found on this profile" };
  return { ok: true, value: undefined };
}

// -----------------------------------------------------------------
// GIGS — declared only
// -----------------------------------------------------------------

export type NewGigInput = {
  externalName?: unknown;
  venue?: unknown;
  city?: unknown;
  gigDate?: unknown;
  role?: unknown;
  b2bWith?: unknown;
  durationMinutes?: unknown;
  flyerUrl?: unknown;
};

/**
 * Adds a gig the artist played somewhere other than HOTU.
 *
 * source is hard-coded to 'declarado' and event_id is never accepted from
 * the caller. A gig at a HOTU event enters by itself from the lineup, and
 * that is the whole reason an organiser can trust the EVENTS count: if the
 * artist could hand-write a row pointing at a HOTU event, the distinction
 * between verified and declared would mean nothing.
 */
export async function createDeclaredGig(
  artistSlug: string,
  input: NewGigInput,
  actorEmail?: string | null
): Promise<WriteResult<{ id: number }>> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const externalName = cleanText(input.externalName, MAX_TITLE);
  if (!externalName) {
    return { ok: false, status: 400, error: "externalName is required for a declared gig" };
  }

  const gigDate = cleanDate(input.gigDate);
  if (!gigDate) {
    return { ok: false, status: 400, error: "gigDate must be a real YYYY-MM-DD date" };
  }

  const flyerUrl = cleanUrl(input.flyerUrl);
  if (flyerUrl === undefined) {
    return { ok: false, status: 400, error: "flyerUrl must be an http(s) URL" };
  }

  let durationMinutes: number | null = null;
  if (input.durationMinutes !== undefined && input.durationMinutes !== null && input.durationMinutes !== "") {
    const n = Number(input.durationMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) {
      return { ok: false, status: 400, error: "durationMinutes must be a whole number of minutes under 24h" };
    }
    durationMinutes = n;
  }

  const rows = await sql`
    INSERT INTO artist_gigs
      (artist_slug, event_id, external_name, flyer_url, venue, city,
       gig_date, district, role, b2b_with, duration_minutes, source)
    VALUES
      (${artistSlug}, NULL, ${externalName}, ${flyerUrl},
       ${optionalText(input.venue, MAX_SHORT)}, ${optionalText(input.city, MAX_SHORT)},
       ${gigDate}::date, ${auth.value.district},
       ${optionalText(input.role, MAX_SHORT)}, ${optionalText(input.b2bWith, MAX_SHORT)},
       ${durationMinutes}, 'declarado')
    RETURNING id
  `;
  return { ok: true, value: { id: rows[0].id as number } };
}

/**
 * Deletes a declared gig. A gig sourced from a HOTU lineup is refused: it
 * is a record of a booking that happened, not profile content, and it
 * reappears from the lineup anyway.
 */
export async function deleteDeclaredGig(
  artistSlug: string,
  gigId: number,
  actorEmail?: string | null
): Promise<WriteResult> {
  const auth = await authorize(artistSlug, actorEmail);
  if (!auth.ok) return auth;

  const existing = await sql`
    SELECT id, source FROM artist_gigs WHERE id = ${gigId} AND artist_slug = ${artistSlug}
  `;
  if (existing.length === 0) {
    return { ok: false, status: 404, error: "Gig not found on this profile" };
  }
  if (existing[0].source !== "declarado") {
    return {
      ok: false,
      status: 403,
      error: "A gig from a HOTU lineup cannot be deleted by hand",
    };
  }

  await sql`DELETE FROM artist_gigs WHERE id = ${gigId} AND artist_slug = ${artistSlug}`;
  return { ok: true, value: undefined };
}
