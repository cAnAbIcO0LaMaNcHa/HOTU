export type DistrictId =
  | "D00"
  | "D01"
  | "D02"
  | "D03"
  | "D04"
  | "D05"
  | "D06"
  | "D07"
  | "D08"
  | "D09";

export type District = {
  id: DistrictId;
  /** Number shown in the title, e.g. "00" */
  number: string;
  /** Visible title, e.g. "DISTRITO 00" — never show raw color or id */
  title: string;
  /** Visible subtitle: the genre */
  genre: string;
  /** Color name — purely internal/aesthetic, never rendered as text */
  colorName: string;
};

export const DISTRICTS: readonly District[] = [
  { id: "D00", number: "00", title: "DISTRITO 00", genre: "T/RAP", colorName: "Silver" },
  { id: "D01", number: "01", title: "DISTRITO 01", genre: "House", colorName: "Blue Chrome" },
  { id: "D02", number: "02", title: "DISTRITO 02", genre: "Melodic", colorName: "White Chrome" },
  { id: "D03", number: "03", title: "DISTRITO 03", genre: "Tech House", colorName: "Bronze Chrome" },
  { id: "D04", number: "04", title: "DISTRITO 04", genre: "Guaracha", colorName: "Green Chrome" },
  { id: "D05", number: "05", title: "DISTRITO 05", genre: "Hard Trance", colorName: "Pink Chrome" },
  { id: "D06", number: "06", title: "DISTRITO 06", genre: "Hard Groove", colorName: "Purple Chrome" },
  { id: "D07", number: "07", title: "DISTRITO 07", genre: "Hard Tech", colorName: "Red Chrome" },
  { id: "D08", number: "08", title: "DISTRITO 08", genre: "Psy Trance", colorName: "Gold Chrome" },
  { id: "D09", number: "09", title: "DISTRITO 09", genre: "Hard Core", colorName: "Black Chrome" },
] as const;

export const DEFAULT_DISTRICT: DistrictId = "D00";

export function getDistrict(id: DistrictId | string | undefined): District {
  return DISTRICTS.find((d) => d.id === id) ?? DISTRICTS[0];
}

export function isDistrictId(value: unknown): value is DistrictId {
  return typeof value === "string" && DISTRICTS.some((d) => d.id === value);
}

/** D00 shows everything; any other district filters by exact match. */
export function matchesDistrict(itemDistrict: DistrictId, active: DistrictId) {
  return active === "D00" || itemDistrict === active;
}
