export type CollectiveType = "HOTU" | "LOCAL";

export type Collective = {
  slug: string;
  name: string;
  type: CollectiveType;
  /** Sector/zone used for grouping, e.g. "Bogotá Centro", "Sabana Norte" */
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
    sector: "Bogotá Centro",
    bio: "El núcleo oficial de HOTU. Artistas de la casa que definen el sonido y el estándar de cada fiesta HOTU, desde warehouse raves hasta el Ritual Open Air.",
    artistSlugs: ["nina-acid", "spf-bog"],
  },
  {
    slug: "hotu-138",
    name: "HOTU 138",
    type: "HOTU",
    sector: "Sabana Norte",
    bio: "La rama de HOTU dedicada al hard groove y BPMs altos en La Calera y Chía. Nace del Ritual Open Air.",
    artistSlugs: ["bloq-klok"],
  },
  {
    slug: "subsuelo-djs",
    name: "Subsuelo DJs",
    type: "LOCAL",
    sector: "Bogotá Centro",
    bio: "Colectivo independiente bogotano enfocado en techno crudo de club. Programan Bodega 38 desde 2023.",
    artistSlugs: [],
  },
  {
    slug: "chia-underground",
    name: "Chía Underground",
    type: "LOCAL",
    sector: "Sabana Norte",
    bio: "Crew de Chía que lleva más de 15 ediciones de fiestas en fincas de la sabana norte, con enfoque en talento emergente.",
    artistSlugs: [],
  },
  {
    slug: "paramo-club",
    name: "Páramo Club",
    type: "LOCAL",
    sector: "La Calera",
    bio: "Colectivo de La Calera especializado en open airs de altura, mezclando naturaleza y hard trance.",
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
