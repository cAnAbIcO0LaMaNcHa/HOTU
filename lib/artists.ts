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
    genre: "Hard Tech",
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
    genre: "Hard Tech",
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
  {
    slug: "monte-negro",
    name: "Monte Negro",
    genre: "Hard Trance",
    district: "D05",
    city: "La Calera",
    bio: "Proyecto de La Calera que fusiona hard trance con paisajes sonoros de montaña. Habitual en el Ritual Open Air.",
    joinedAt: "2026-06-03",
    sets: [{ title: "HOTU Ritual · Sunrise Set", url: "#", duration: "1H 30M" }],
    topTracks: [{ title: "Trance en la Montaña", url: "#" }],
  },
  {
    slug: "subsuelo-x",
    name: "Subsuelo X",
    genre: "House",
    district: "D01",
    city: "Bogotá",
    bio: "Ala house de Subsuelo DJs. Groove profundo para las horas tempranas de la fiesta.",
    joinedAt: "2026-06-05",
    sets: [{ title: "Bodega 38 · Opening Set", url: "#", duration: "1H 15M" }],
    topTracks: [{ title: "Bajo Tierra", url: "#" }],
  },
  {
    slug: "paramo-selecta",
    name: "Páramo Selecta",
    genre: "Guaracha",
    district: "D04",
    city: "La Calera",
    bio: "Selección de Páramo Club dedicada a la guaracha bogotana, con sets pensados para el amanecer en altura.",
    joinedAt: "2026-06-07",
    sets: [{ title: "Páramo Sunrise", url: "#", duration: "1H 50M" }],
    topTracks: [{ title: "Altura Guaracha", url: "#" }],
  },
  {
    slug: "rapido-138",
    name: "Rápido 138",
    genre: "T/RAP",
    district: "D00",
    city: "Bogotá",
    bio: "Proyecto abierto de HOTU sin frontera de género, siempre a 138 BPM. La puerta de entrada al universo HOTU.",
    joinedAt: "2026-06-09",
    sets: [{ title: "HOTU Open Format Vol. 1", url: "#", duration: "1H 20M" }],
    topTracks: [{ title: "Puerta 138", url: "#" }],
  },
  {
    slug: "melodic-flux",
    name: "Melodic Flux",
    genre: "Melodic",
    district: "D02",
    city: "Medellín",
    bio: "Productor paisa de melodic techno, conocido por sets emotivos al atardecer.",
    joinedAt: "2026-06-11",
    sets: [{ title: "Atardecer Paisa", url: "#", duration: "1H 40M" }],
    topTracks: [{ title: "Flux Interior", url: "#" }],
  },
  {
    slug: "tech-house-crew",
    name: "Tech House Crew",
    genre: "Tech House",
    district: "D03",
    city: "Cali",
    bio: "Trío caleño especializado en tech house groovy para pistas llenas.",
    joinedAt: "2026-06-13",
    sets: [{ title: "Cali Groove Session", url: "#", duration: "1H 10M" }],
    topTracks: [{ title: "Salsa Tech", url: "#" }],
  },
  {
    slug: "psy-sabana",
    name: "Psy Sabana",
    genre: "Psy Trance",
    district: "D08",
    city: "La Calera",
    bio: "Psicodelia y trance de alta montaña. Referente de los amaneceres del Ritual Open Air.",
    joinedAt: "2026-06-15",
    sets: [{ title: "Amanecer Psicodélico", url: "#", duration: "2H 00M" }],
    topTracks: [{ title: "Tercer Ojo", url: "#" }],
  },
  {
    slug: "hardcore-bog",
    name: "Hardcore BOG",
    genre: "Hard Core",
    district: "D09",
    city: "Bogotá",
    bio: "El extremo más oscuro de HOTU. Hardcore crudo para el cierre de las fiestas más intensas.",
    joinedAt: "2026-06-17",
    sets: [{ title: "Cierre Total", url: "#", duration: "1H 05M" }],
    topTracks: [{ title: "Oscuridad Total", url: "#" }],
  },
  {
    slug: "groove-norte",
    name: "Groove Norte",
    genre: "Hard Groove",
    district: "D06",
    city: "Chía",
    bio: "Segunda generación del hard groove de la sabana norte, heredero directo de HOTU 138.",
    joinedAt: "2026-06-19",
    sets: [{ title: "Norte Sessions", url: "#", duration: "1H 25M" }],
    topTracks: [{ title: "Groove del Norte", url: "#" }],
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

/** Full artist catalog, newest first. Used by the Home rotator and /artistas. */
export function getAllArtistsSorted(): Artist[] {
  return [...ARTISTS].sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());
}
