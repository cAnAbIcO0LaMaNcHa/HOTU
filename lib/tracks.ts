export type Track = {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
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
    releasedAt: "2026-06-27",
    url: "#",
  },
  {
    slug: "klok-machine",
    title: "Klok Machine",
    artistName: "Bloq Klok",
    artistSlug: "bloq-klok",
    releasedAt: "2026-06-29",
    url: "#",
  },
  {
    slug: "spf-138",
    title: "SPF 138",
    artistName: "SPF/BOG",
    artistSlug: "spf-bog",
    releasedAt: "2026-07-01",
    url: "#",
  },
];

export function getRecentTracks(n = 3): Track[] {
  return [...TRACKS]
    .sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime())
    .slice(0, n);
}
