import { neon } from "@neondatabase/serverless";
import type { DistrictId } from "./districts";

const sql = neon(process.env.DATABASE_URL!);

/**
 * artists.sets, artists.top_tracks and collectives.artist_slugs are NOT
 * mapped here any more. They were prototype placeholders (every url was
 * "#") that duplicated data now living in dj_sets, tracks and
 * artist_collectives, and nothing renders them. The columns still exist as
 * a fallback, but keeping them on the types would invite somebody to start
 * reading them again by accident.
 */

/** Shared editorial fields every content entity now carries. */
export type ContentMeta = {
  scope: "global" | "country";
  countryCode: string;
  language: string;
  status: "draft" | "published" | "archived";
  featured: boolean;
  priorityAt: string | null;
};

/**
 * The EPK's social row. Every key is optional — the profile grows with the
 * artist, and an empty platform is simply not rendered.
 *
 * Defined in lib/socials.ts, not here: client components need the list as a
 * runtime value, and importing a value from this module would drag the neon
 * client into the browser bundle. Re-exported so server-side callers do not
 * have to care.
 */
export {
  SOCIAL_PLATFORMS,
  SOCIAL_LABELS,
  type SocialPlatform,
  type ArtistSocials,
} from "./socials";

import type { ArtistSocials } from "./socials";

export type Artist = ContentMeta & {
  slug: string;
  name: string;
  genre: string;
  district: DistrictId;
  city: string;
  photo?: string;
  bio: string;
  joinedAt: string;
  /** EPK fields added in tanda 1. */
  coverUrl?: string;
  /** The line under the name in the header, e.g. "DJ & Productor". */
  role?: string;
  /** Public booking address, NOT the address the owner logs in with. */
  contactEmail?: string;
  /** Public booking phone, NOT user_profiles.phone, which is private. */
  contactPhone?: string;
  /** Where they are from, as opposed to `city`, where they live now. */
  origin?: string;
  bpmMin?: number;
  bpmMax?: number;
  socials: ArtistSocials;
};

export type Track = ContentMeta & {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
  district: DistrictId;
  releasedAt: string;
  url: string;
  /** Tanda 2: cover art, imprint, and a manual position. */
  coverUrl?: string;
  label?: string;
  /** NULL means "no manual position" — readers fall back to the date. */
  sortOrder?: number;
};

export type DjSet = ContentMeta & {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
  district: DistrictId;
  duration: string;
  recordedAt: string;
  url: string;
  coverUrl?: string;
  sortOrder?: number;
};

export type Collective = ContentMeta & {
  slug: string;
  name: string;
  type: "HOTU" | "LOCAL";
  sector: string;
  bio: string;
  district: DistrictId;
};

/*
 * status_membership is no longer mapped. The 3-DJs/2-residents minimum was
 * removed in tanda 3 (§1.1): there is no publishable/incomplete state, and
 * a collective with one member can publish. The column still exists in the
 * table, frozen — a column is never dropped in the same migration that
 * stops using it — but it is not read, not written, and not on the type,
 * so nothing can start depending on it again by accident.
 */

export type EventItem = ContentMeta & {
  id: number;
  date: string;
  endAt: string | null;
  flyerUrl: string | null;
  city: string;
  venue: string;
  title: string;
  lineup: string;
  district: DistrictId;
};

export type NewsItem = ContentMeta & {
  id: number;
  tag: string;
  date: string;
  title: string;
  excerpt: string;
  district: DistrictId;
};

/** Options accepted by every list-read function below. */
export type ReadOptions = {
  /** When true, returns drafts/archived rows too — for admin screens only. */
  includeAll?: boolean;
};

// Pure date helpers live in ./date-utils, which has zero dependency on
// this file's `neon()` connection — re-exported here so existing server
// code can keep importing them from "@/lib/db" unchanged, while client
// components import straight from "@/lib/date-utils" to avoid pulling
// the database client (and DATABASE_URL) into the browser bundle.
export { toISODate, formatShortDate, eventHasEnded } from "./date-utils";
import { toISODate } from "./date-utils";

function mapMeta(r: Record<string, unknown>): ContentMeta {
  return {
    scope: (r.scope as ContentMeta["scope"]) ?? "country",
    countryCode: (r.country_code as string) ?? "COL",
    language: (r.language as string) ?? "es",
    status: (r.status as ContentMeta["status"]) ?? "published",
    featured: Boolean(r.featured),
    priorityAt: r.priority_at ? new Date(r.priority_at as string).toISOString() : null,
  };
}

/** Single place the artists table is turned into an Artist, so the list
 *  and the profile can never drift apart on which columns they read. */
function mapArtist(r: Record<string, unknown>): Artist {
  return {
    ...mapMeta(r),
    slug: r.slug as string,
    name: r.name as string,
    genre: r.genre as string,
    district: r.district as DistrictId,
    city: r.city as string,
    photo: (r.photo as string) ?? undefined,
    bio: r.bio as string,
    joinedAt: toISODate(r.joined_at as string),
    coverUrl: (r.cover_url as string) ?? undefined,
    role: (r.role as string) ?? undefined,
    contactEmail: (r.contact_email as string) ?? undefined,
    contactPhone: (r.contact_phone as string) ?? undefined,
    origin: (r.origin as string) ?? undefined,
    bpmMin: r.bpm_min === null || r.bpm_min === undefined ? undefined : Number(r.bpm_min),
    bpmMax: r.bpm_max === null || r.bpm_max === undefined ? undefined : Number(r.bpm_max),
    socials: (r.socials ?? {}) as ArtistSocials,
  };
}

export async function getAllArtists(opts: ReadOptions = {}): Promise<Artist[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM artists ORDER BY joined_at DESC`
    : await sql`SELECT * FROM artists WHERE status = 'published' ORDER BY joined_at DESC`;
  return rows.map(mapArtist);
}

export async function getArtistBySlug(slug: string): Promise<Artist | undefined> {
  const rows = await sql`SELECT * FROM artists WHERE slug = ${slug} AND status = 'published'`;
  if (rows.length === 0) return undefined;
  return mapArtist(rows[0]);
}

/** Nullable integer column to an optional number, without turning 0 into
 *  undefined — sort_order 0 is a legitimate first position. */
function optionalInt(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

/** One place each table becomes its type, so the catalogue listings and the
 *  EPK sections can never drift on which columns they read. */
function mapTrack(r: Record<string, unknown>): Track {
  return {
    ...mapMeta(r),
    slug: r.slug as string,
    title: r.title as string,
    artistName: r.artist_name as string,
    artistSlug: (r.artist_slug as string) ?? undefined,
    district: r.district as DistrictId,
    releasedAt: toISODate(r.released_at as string),
    url: r.url as string,
    coverUrl: (r.cover_url as string) ?? undefined,
    label: (r.label as string) ?? undefined,
    sortOrder: optionalInt(r.sort_order),
  };
}

function mapDjSet(r: Record<string, unknown>): DjSet {
  return {
    ...mapMeta(r),
    slug: r.slug as string,
    title: r.title as string,
    artistName: r.artist_name as string,
    artistSlug: (r.artist_slug as string) ?? undefined,
    district: r.district as DistrictId,
    duration: r.duration as string,
    recordedAt: toISODate(r.recorded_at as string),
    url: r.url as string,
    coverUrl: (r.cover_url as string) ?? undefined,
    sortOrder: optionalInt(r.sort_order),
  };
}

export async function getAllTracks(opts: ReadOptions = {}): Promise<Track[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM tracks ORDER BY released_at DESC`
    : await sql`SELECT * FROM tracks WHERE status = 'published' ORDER BY released_at DESC`;
  return rows.map(mapTrack);
}

export async function getAllSets(opts: ReadOptions = {}): Promise<DjSet[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM dj_sets ORDER BY recorded_at DESC`
    : await sql`SELECT * FROM dj_sets WHERE status = 'published' ORDER BY recorded_at DESC`;
  return rows.map(mapDjSet);
}

/**
 * A gig the artist played. Rows sourced from a HOTU lineup carry eventId
 * and the event's own flyer; declared gigs carry externalName and whatever
 * flyer the artist uploaded themselves.
 */
export type ArtistGig = {
  id: number;
  artistSlug: string;
  eventId: number | null;
  eventTitle: string | null;
  externalName: string | null;
  flyerUrl: string | null;
  venue: string | null;
  city: string | null;
  gigDate: string;
  district: DistrictId | null;
  role: string | null;
  b2bWith: string | null;
  durationMinutes: number | null;
  source: "hotu" | "declarado";
};

/**
 * The EPK's DJ SETS section — the real dj_sets rows, not artists.sets.
 *
 * sort_order first, NULLS LAST, then the date. An artist who never
 * reorders anything still gets newest-first; one who drags a favourite to
 * the top gets exactly that, without having to position everything else.
 */
export async function getSetsByArtist(slug: string): Promise<DjSet[]> {
  const rows = await sql`
    SELECT * FROM dj_sets
    WHERE artist_slug = ${slug} AND status = 'published'
    ORDER BY sort_order ASC NULLS LAST, recorded_at DESC
  `;
  return rows.map(mapDjSet);
}

/** The EPK's TRACKS section — the real tracks rows, not artists.top_tracks. */
export async function getTracksByArtist(slug: string): Promise<Track[]> {
  const rows = await sql`
    SELECT * FROM tracks
    WHERE artist_slug = ${slug} AND status = 'published'
    ORDER BY sort_order ASC NULLS LAST, released_at DESC
  `;
  return rows.map(mapTrack);
}

/**
 * The EPK's EVENTS carousel. A HOTU gig falls back to the event's own
 * flyer, title, venue and city when the gig row leaves them blank, so a
 * lineup import only has to store the link.
 */
export async function getGigsByArtist(slug: string): Promise<ArtistGig[]> {
  const rows = await sql`
    SELECT g.*,
           e.title     AS event_title,
           e.flyer_url AS event_flyer_url,
           e.venue     AS event_venue,
           e.city      AS event_city
    FROM artist_gigs g
    LEFT JOIN events e ON e.id = g.event_id
    WHERE g.artist_slug = ${slug}
    ORDER BY g.gig_date DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    artistSlug: r.artist_slug,
    eventId: r.event_id ?? null,
    eventTitle: r.event_title ?? null,
    externalName: r.external_name ?? null,
    flyerUrl: r.flyer_url ?? r.event_flyer_url ?? null,
    venue: r.venue ?? r.event_venue ?? null,
    city: r.city ?? r.event_city ?? null,
    gigDate: toISODate(r.gig_date),
    district: (r.district as DistrictId) ?? null,
    role: r.role ?? null,
    b2bWith: r.b2b_with ?? null,
    durationMinutes: r.duration_minutes ?? null,
    source: r.source as "hotu" | "declarado",
  }));
}

export async function getAllCollectives(opts: ReadOptions = {}): Promise<Collective[]> {
  // Ordered by name alone. Sector stopped being the grouping axis in tanda
  // 3 (§1.4) — it is a plain city label now, not a heading to sort under.
  const rows = opts.includeAll
    ? await sql`SELECT * FROM collectives ORDER BY name`
    : await sql`SELECT * FROM collectives WHERE status = 'published' ORDER BY name`;
  return rows.map((r) => ({
    ...mapMeta(r),
    slug: r.slug,
    name: r.name,
    type: r.type as "HOTU" | "LOCAL",
    sector: r.sector,
    bio: r.bio,
    district: r.district as DistrictId,
  }));
}

/** One active membership, with the artist's display name resolved. */
export type CollectiveMember = {
  collectiveSlug: string;
  artistSlug: string;
  artistName: string;
  kind: "casa" | "residente";
  fromDate: string;
};

/**
 * Active memberships for every collective, grouped by collective slug.
 *
 * This replaces reading collectives.artist_slugs. One query for the whole
 * page rather than one per collective, and it joins artists so the caller
 * does not have to hold a second lookup table just to print names.
 *
 * Residents first, then allies, each alphabetically — a stable order that
 * does not shuffle as rows are added.
 */
export async function getCollectiveMembers(): Promise<Map<string, CollectiveMember[]>> {
  const rows = await sql`
    SELECT ac.collective_slug, ac.artist_slug, ac.kind, ac.from_date, a.name AS artist_name
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    WHERE ac.to_date IS NULL
    ORDER BY ac.collective_slug,
             CASE ac.kind WHEN 'casa' THEN 0 ELSE 1 END,
             a.name
  `;
  const byCollective = new Map<string, CollectiveMember[]>();
  for (const r of rows) {
    const slug = r.collective_slug as string;
    if (!byCollective.has(slug)) byCollective.set(slug, []);
    byCollective.get(slug)!.push({
      collectiveSlug: slug,
      artistSlug: r.artist_slug as string,
      artistName: r.artist_name as string,
      kind: r.kind as "casa" | "residente",
      fromDate: toISODate(r.from_date as string),
    });
  }
  return byCollective;
}

/*
 * getCollectivesBySector was removed in tanda 3 (§1.4). It had no callers
 * left once /colectivos stopped grouping by sector, and a dead grouping
 * helper is an invitation to group by it again.
 */

export async function getAllEvents(opts: ReadOptions = {}): Promise<EventItem[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM events ORDER BY event_date ASC`
    : await sql`SELECT * FROM events WHERE status = 'published' ORDER BY event_date ASC`;
  return rows.map((r) => ({
    ...mapMeta(r),
    id: r.id,
    date: toISODate(r.event_date),
    endAt: r.end_at ? new Date(r.end_at as string).toISOString() : null,
    flyerUrl: (r.flyer_url as string | null) ?? null,
    city: r.city,
    venue: r.venue,
    title: r.title,
    lineup: r.lineup,
    district: r.district as DistrictId,
  }));
}

export async function getAllNews(opts: ReadOptions = {}): Promise<NewsItem[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM news ORDER BY news_date DESC`
    : await sql`SELECT * FROM news WHERE status = 'published' ORDER BY news_date DESC`;
  return rows.map((r) => ({
    ...mapMeta(r),
    id: r.id,
    tag: r.tag,
    date: toISODate(r.news_date),
    title: r.title,
    excerpt: r.excerpt,
    district: r.district as DistrictId,
  }));
}
