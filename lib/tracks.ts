import type { DistrictId } from "./districts";

export type Track = {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
  district: DistrictId;
  cover?: string;
  /** ISO date of release. The 3 most recent always show on Home. */
  releasedAt: string;
  url: string;
};

/**
 * PUSH MECHANIC: same idea as artists.ts — add a new track anywhere in this
 * array with this week's date as `releasedAt`, and it automatically becomes
 * part of the 3 most recent shown on Home. No other code needs to change.
 */
export const TRACKS: Track[] = [
  {
    slug: "acido-en-la-sabana",
    title: "Ácido en la Sabana",
    artistName: "Nina Acid",
    artistSlug: "nina-acid",
    district: "D07",
    releasedAt: "2026-06-27",
    url: "#",
  },
  {
    slug: "klok-machine",
    title: "Klok Machine",
    artistName: "Bloq Klok",
    artistSlug: "bloq-klok",
    district: "D06",
    releasedAt: "2026-06-29",
    url: "#",
  },
  {
    slug: "spf-138",
    title: "SPF 138",
    artistName: "SPF/BOG",
    artistSlug: "spf-bog",
    district: "D07",
    releasedAt: "2026-07-01",
    url: "#",
  },
  {
    slug: "trance-en-la-montana",
    title: "Trance en la Montaña",
    artistName: "Monte Negro",
    artistSlug: "monte-negro",
    district: "D05",
    releasedAt: "2026-07-03",
    url: "#",
  },
  {
    slug: "bajo-tierra",
    title: "Bajo Tierra",
    artistName: "Subsuelo X",
    artistSlug: "subsuelo-x",
    district: "D01",
    releasedAt: "2026-07-05",
    url: "#",
  },
  {
    slug: "altura-guaracha",
    title: "Altura Guaracha",
    artistName: "Páramo Selecta",
    artistSlug: "paramo-selecta",
    district: "D04",
    releasedAt: "2026-07-07",
    url: "#",
  },
];

export function getRecentTracks(n = 3): Track[] {
  return [...TRACKS]
    .sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime())
    .slice(0, n);
}

/** Full catalog, newest first. Used by /discografia and the Home rotator — single source of truth. */
export function getAllTracksSorted(): Track[] {
  return [...TRACKS].sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime());
}
