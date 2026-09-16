/**
 * Los diez distritos: id, personaje, género y color.
 *
 * NADIE IMPORTA ESTE ARCHIVO. Se retiró entero en la tanda 4 §3, cuando
 * el sistema de distritos fue reemplazado por la taxonomía de géneros:
 * los filtros pasaron a ser rama y tag, las diez reglas de color se
 * borraron de globals.css, y ningún camino de escritura copia ya el
 * distrito a ninguna fila.
 *
 * Se conserva igual, por las mismas razones que lib/crypto.ts:
 *
 * 1. LAS COLUMNAS SIGUEN EN LA BASE. Siete tablas tienen district con
 *    sus valores intactos, congelados. La migración que algún día las
 *    borre va a querer saber qué significaba cada código antes de
 *    tirarlos, y "D07" sin esta tabla no significa nada.
 * 2. events.district NO SE PUEDE BORRAR, y no es un pendiente: lo
 *    congela boletería. El display_code de cada boleta se arma como
 *    HOTU-07-AD0002, con el número del distrito adelante, y hay boletas
 *    vendidas con ese formato que se leen en la puerta. Está en
 *    PROGRESO.md.
 * 3. ES LA REFERENCIA DEL UNIVERSO VISUAL. Los personajes —ID, MINIMAL,
 *    PERSONA, MUSE, MANIAC, DISCREET, INDISCREET, NAIVE, MAGNET, MASK—
 *    y sus colores son material de marca, no configuración. Que el sitio
 *    ya no los use para filtrar no los borra de la estética.
 *
 * Quedar sin importadores es el estado deliberado, no un descuido.
 * Borrar el archivo es una decisión aparte, y va después de que las
 * columnas se hayan ido.
 */
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

export function isDistrictId(value: unknown): value is DistrictId {
  return typeof value === "string" && DISTRICTS.some((d) => d.id === value);
}

/** D00 shows everything; any other district filters by exact match. */
export function matchesDistrict(itemDistrict: DistrictId, active: DistrictId) {
  return active === "D00" || itemDistrict === active;
}
