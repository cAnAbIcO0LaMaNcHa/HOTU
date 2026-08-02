import type { DistrictId } from "./districts";

export type ArtistSet = {
  title: string;
  url: string;
  duration?: string;
};

export type ArtistTrack = {
  title: string;
  url: string;
};

export type Artist = {
  slug: string;
  name: string;
  genre: string;
  district: DistrictId;
  city: string;
  photo?: string;
  bio: string;
  /** ISO date. New artists get today's date — the 3 most recent always show on Home. */
  joinedAt: string;
  sets: ArtistSet[];
  topTracks: ArtistTrack[];
};

/**
 * PUSH MECHANIC: this array is the single source of truth for artists.
 * To add a new artist to HOTU, just add a new object anywhere in this array
 * with today's date as `joinedAt`. The Home page and /artistas automatically
 * show the 3 most recent (sorted by joinedAt, descending) — no other code
 * needs to change.
 */
export const ARTISTS: Artist[] = [
  {
    slug: "nina-acid",
    name: "Nina Acid",
    genre: "Acid / Techno",
    district: "D07",
    city: "Bogotá",
    bio: "Productora y DJ bogotana referente del sonido acid techno en la sabana. Residente de HOTU desde sus inicios, su sonido cruza líneas ácidas del 303 con groove industrial.",
    joinedAt: "2026-05-28",
    sets: [
      { title: "HOTU PRIME · Raw Hard Set", url: "#", duration: "2H 14M" },
      { title: "Boiler Room Bogotá 2025", url: "#", duration: "1H 02M" },
    ],
    topTracks: [
      { title: "Ácido en la Sabana", url: "#" },
      { title: "138 Sirens", url: "#" },
    ],
  },
  {
    slug: "bloq-klok",
    name: "Bloq Klok",
    genre: "Hard Groove",
    district: "D06",
    city: "Chía",
    bio: "Dúo de Chía especializado en hard groove con influencias de percusión latinoamericana. HOTU Resident desde 2025.",
    joinedAt: "2026-05-30",
    sets: [{ title: "HOTU Ritual Open Air", url: "#", duration: "1H 45M" }],
    topTracks: [
      { title: "Klok Machine", url: "#" },
      { title: "Sabana Groove", url: "#" },
    ],
  },
  {
    slug: "spf-bog",
    name: "SPF/BOG",
    genre: "Hard Techno",
    district: "D07",
    city: "Bogotá",
    bio: "Uno de los actos más contundentes de la escena hard techno bogotana. Sets crudos, rápidos y sin concesiones.",
    joinedAt: "2026-06-01",
    sets: [{ title: "Subterráneo Reopening Set", url: "#", duration: "3H 00M" }],
    topTracks: [
      { title: "SPF 138", url: "#" },
      { title: "Blackout Protocol", url: "#" },
    ],
  },
];

export function getArtistBySlug(slug: string): Artist | undefined {
  return ARTISTS.find((a) => a.slug === slug);
}

/** The N most recently joined artists, newest first. Used by Home's "push" feed. */
export function getRecentArtists(n = 3): Artist[] {
  return [...ARTISTS]
    .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
    .slice(0, n);
}
