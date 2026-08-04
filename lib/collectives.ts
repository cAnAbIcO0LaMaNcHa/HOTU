export type CollectiveType = "HOTU" | "LOCAL";

export type Collective = {
  slug: string;
  name: string;
  type: CollectiveType;
  /** Sector used for grouping — major Colombian cities */
  sector: string;
  bio: string;
  /** Artist slugs from artists.ts belonging to this collective */
  artistSlugs: string[];
};

export const COLLECTIVES: Collective[] = [
  {
    slug: "hotu-residents",
    name: "HOTU Residents",
    type: "HOTU",
    sector: "Bogotá",
    bio: "El núcleo oficial de HOTU. Artistas de la casa que definen el sonido y el estándar de cada fiesta HOTU.",
    artistSlugs: ["nina-acid", "spf-bog", "hardcore-bog", "rapido-138"],
  },
  {
    slug: "hotu-138",
    name: "HOTU 138",
    type: "HOTU",
    sector: "Medellín",
    bio: "La rama de HOTU dedicada al hard groove y BPMs altos, expandida al paisa.",
    artistSlugs: ["bloq-klok", "melodic-flux"],
  },
  {
    slug: "subsuelo-djs",
    name: "Subsuelo DJs",
    type: "LOCAL",
    sector: "Cali",
    bio: "Colectivo independiente enfocado en techno crudo de club. Programan Bodega 38 desde 2023.",
    artistSlugs: ["subsuelo-x", "tech-house-crew"],
  },
  {
    slug: "chia-underground",
    name: "Chía Underground",
    type: "LOCAL",
    sector: "Cartagena",
    bio: "Crew que lleva más de 15 ediciones de fiestas, con enfoque en talento emergente costero.",
    artistSlugs: ["groove-norte"],
  },
  {
    slug: "paramo-club",
    name: "Páramo Club",
    type: "LOCAL",
    sector: "Neiva",
    bio: "Colectivo especializado en open airs de altura, mezclando naturaleza y hard trance.",
    artistSlugs: ["paramo-selecta", "psy-sabana"],
  },
  {
    slug: "pereira-sonora",
    name: "Pereira Sonora",
    type: "LOCAL",
    sector: "Pereira",
    bio: "Escena emergente del eje cafetero, mezclando sonidos tradicionales con techno experimental.",
    artistSlugs: [],
  },
];

export function getCollectivesBySector() {
  const sectors = new Map<string, Collective[]>();
  for (const c of COLLECTIVES) {
    if (!sectors.has(c.sector)) sectors.set(c.sector, []);
    sectors.get(c.sector)!.push(c);
  }
  return sectors;
}
