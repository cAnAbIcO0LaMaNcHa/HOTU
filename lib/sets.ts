import type { DistrictId } from "./districts";

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

export const SETS: DjSet[] = [
  {
    slug: "hotu-prime-raw-hard-set",
    title: "HOTU PRIME · Raw Hard Set",
    artistName: "Nina Acid",
    artistSlug: "nina-acid",
    district: "D07",
    duration: "2H 14M",
    recordedAt: "2026-06-14",
    url: "#",
  },
  {
    slug: "hotu-ritual-open-air",
    title: "HOTU Ritual Open Air",
    artistName: "Bloq Klok",
    artistSlug: "bloq-klok",
    district: "D06",
    duration: "1H 45M",
    recordedAt: "2026-06-22",
    url: "#",
  },
  {
    slug: "subterraneo-reopening-set",
    title: "Subterráneo Reopening Set",
    artistName: "SPF/BOG",
    artistSlug: "spf-bog",
    district: "D07",
    duration: "3H 00M",
    recordedAt: "2026-06-01",
    url: "#",
  },
  {
    slug: "hotu-ritual-sunrise-set",
    title: "HOTU Ritual · Sunrise Set",
    artistName: "Monte Negro",
    artistSlug: "monte-negro",
    district: "D05",
    duration: "1H 30M",
    recordedAt: "2026-06-22",
    url: "#",
  },
  {
    slug: "bodega-38-opening-set",
    title: "Bodega 38 · Opening Set",
    artistName: "Subsuelo X",
    artistSlug: "subsuelo-x",
    district: "D01",
    duration: "1H 15M",
    recordedAt: "2026-06-14",
    url: "#",
  },
  {
    slug: "paramo-sunrise",
    title: "Páramo Sunrise",
    artistName: "Páramo Selecta",
    artistSlug: "paramo-selecta",
    district: "D04",
    duration: "1H 50M",
    recordedAt: "2026-06-22",
    url: "#",
  },
];

export function getAllSetsSorted(): DjSet[] {
  return [...SETS].sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
}
