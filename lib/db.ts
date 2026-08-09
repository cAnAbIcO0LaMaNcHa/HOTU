import { neon } from "@neondatabase/serverless";
import type { DistrictId } from "./districts";

const sql = neon(process.env.DATABASE_URL!);

export type ArtistSet = { title: string; url: string; duration?: string };
export type ArtistTrack = { title: string; url: string };

export type Artist = {
  slug: string;
  name: string;
  genre: string;
  district: DistrictId;
  city: string;
  photo?: string;
  bio: string;
  joinedAt: string;
  sets: ArtistSet[];
  topTracks: ArtistTrack[];
};

export type Track = {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
  district: DistrictId;
  releasedAt: string;
  url: string;
};

export type DjSet = {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
  district: DistrictId;
  duration: string;
  recordedAt: string;
  url: string;
};

export type Collective = {
  slug: string;
  name: string;
  type: "HOTU" | "LOCAL";
  sector: string;
  bio: string;
  artistSlugs: string[];
};

export type EventItem = {
  id: number;
  date: string;
  city: string;
  venue: string;
  title: string;
  lineup: string;
  district: DistrictId;
};

export type NewsItem = {
  id: number;
  tag: string;
  date: string;
  title: string;
  excerpt: string;
};

/** Postgres DATE columns come back as Date objects; normalise to YYYY-MM-DD. */
function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Format a date as DD.MM.YY for the compact event/news labels. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

export async function getAllArtists(): Promise<Artist[]> {
  const rows = await sql`SELECT * FROM artists ORDER BY joined_at DESC`;
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    genre: r.genre,
    district: r.district as DistrictId,
    city: r.city,
    photo: r.photo ?? undefined,
    bio: r.bio,
    joinedAt: toISODate(r.joined_at),
    sets: (r.sets ?? []) as ArtistSet[],
    topTracks: (r.top_tracks ?? []) as ArtistTrack[],
  }));
}

export async function getArtistBySlug(slug: string): Promise<Artist | undefined> {
  const rows = await sql`SELECT * FROM artists WHERE slug = ${slug}`;
  if (rows.length === 0) return undefined;
  const r = rows[0];
  return {
    slug: r.slug,
    name: r.name,
    genre: r.genre,
    district: r.district as DistrictId,
    city: r.city,
    photo: r.photo ?? undefined,
    bio: r.bio,
    joinedAt: toISODate(r.joined_at),
    sets: (r.sets ?? []) as ArtistSet[],
    topTracks: (r.top_tracks ?? []) as ArtistTrack[],
  };
}

export async function getAllTracks(): Promise<Track[]> {
  const rows = await sql`SELECT * FROM tracks ORDER BY released_at DESC`;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    artistName: r.artist_name,
    artistSlug: r.artist_slug ?? undefined,
    district: r.district as DistrictId,
    releasedAt: toISODate(r.released_at),
    url: r.url,
  }));
}

export async function getAllSets(): Promise<DjSet[]> {
  const rows = await sql`SELECT * FROM dj_sets ORDER BY recorded_at DESC`;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    artistName: r.artist_name,
    artistSlug: r.artist_slug ?? undefined,
    district: r.district as DistrictId,
    duration: r.duration,
    recordedAt: toISODate(r.recorded_at),
    url: r.url,
  }));
}

export async function getAllCollectives(): Promise<Collective[]> {
  const rows = await sql`SELECT * FROM collectives ORDER BY sector, name`;
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    type: r.type as "HOTU" | "LOCAL",
    sector: r.sector,
    bio: r.bio,
    artistSlugs: (r.artist_slugs ?? []) as string[],
  }));
}

export async function getCollectivesBySector(): Promise<Map<string, Collective[]>> {
  const all = await getAllCollectives();
  const sectors = new Map<string, Collective[]>();
  for (const c of all) {
    if (!sectors.has(c.sector)) sectors.set(c.sector, []);
    sectors.get(c.sector)!.push(c);
  }
  return sectors;
}

export async function getAllEvents(): Promise<EventItem[]> {
  const rows = await sql`SELECT * FROM events ORDER BY event_date ASC`;
  return rows.map((r) => ({
    id: r.id,
    date: toISODate(r.event_date),
    city: r.city,
    venue: r.venue,
    title: r.title,
    lineup: r.lineup,
    district: r.district as DistrictId,
  }));
}

export async function getAllNews(): Promise<NewsItem[]> {
  const rows = await sql`SELECT * FROM news ORDER BY news_date DESC`;
  return rows.map((r) => ({
    id: r.id,
    tag: r.tag,
    date: toISODate(r.news_date),
    title: r.title,
    excerpt: r.excerpt,
  }));
}
