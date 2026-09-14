/**
 * La taxonomía de géneros (tanda 4, §2).
 *
 * Archivo puro: sin base de datos, sin React. Lo lee el seed de
 * /api/seed-genres y cualquier cosa que necesite la lista.
 *
 * ============================================================
 * BRANCHES Y TAGS ESTÁN VACÍOS A PROPÓSITO. FALTA LA FUENTE.
 * ============================================================
 *
 * La fuente es HOTU_DJ_Genre_Classification_2026.docx (v1.0, sept 2026),
 * 34 branches y ~700 tags. Ese archivo NO está en el repo, ni en el
 * historial de git, ni en el disco de esta máquina. Sin él no hay forma
 * de saber cómo se llama cada branch ni qué tags cuelgan de cada uno.
 *
 * Inventarlos sería peor que dejarlos vacíos: quedarían 700 etiquetas
 * plausibles y equivocadas sembradas en producción, y nadie sabría
 * cuáles revisar. Las tablas existen y están listas; llenar este archivo
 * es el único trabajo que queda.
 *
 * Lo único que se sabe de los 34 branches son sus códigos, que sí están
 * en HOTFIX.md §2.1:
 *
 *   HOU TEC TCH MEL MIN ACI GRO BOU IND TRI TRA PSY HDC DNB GAR BAS
 *   GUA AFR AMA EDM ELC DIS TFB REG HIP RNB POP AFB CAR BRF LAT ROC FUN CTY
 *
 * Varios son ambiguos leídos solos (BOU, TFB, CAR, CTY, BRF), así que ni
 * siquiera los nombres se pueden deducir con confianza.
 */

export type GenreBranch = {
  /** Código de 3 letras. Es la PK y lo que guardan los perfiles. */
  code: string;
  name: string;
  /** Agrupador del documento. Texto libre hasta que se sepan los valores. */
  category: string;
  sortOrder: number;
};

export type GenreTag = {
  slug: string;
  name: string;
  /** El branch al que pertenece. Un tag puede repetirse entre branches:
   *  eso es intencional según el documento, y por eso la PK del tag es
   *  (slug, branch_code) y no slug solo. */
  branchCode: string;
  sortOrder: number;
};

/** Alias de búsqueda. Se busca por el alias, se muestra la canónica. */
export type GenreAlias = {
  alias: string;
  branchCode: string;
};

/** VACÍO: falta el .docx. Ver el comentario de arriba. */
export const BRANCHES: GenreBranch[] = [];

/** VACÍO: falta el .docx. Ver el comentario de arriba. */
export const TAGS: GenreTag[] = [];

/**
 * Los alias de búsqueda de HOTFIX.md §2.4. El documento nombra tres
 * equivalencias (DnB = Drum & Bass, UKG = Garage, Guaracha =
 * Aleteo/Zapateo); acá son cinco filas porque Aleteo y Zapateo son dos
 * alias distintos que apuntan al mismo branch, y "Drum and Bass" escrito
 * sin el ampersand es lo que la gente teclea.
 *
 * Los códigos de destino se conocen, pero los branches todavía no
 * existen como filas, así que el seed los va a saltear hasta que
 * BRANCHES esté lleno.
 */
export const ALIASES: GenreAlias[] = [
  { alias: "DnB", branchCode: "DNB" },
  { alias: "Drum and Bass", branchCode: "DNB" },
  { alias: "UKG", branchCode: "GAR" },
  { alias: "Aleteo", branchCode: "GUA" },
  { alias: "Zapateo", branchCode: "GUA" },
];

/**
 * Cross-tags: era, contexto, formato, energía y tipo de DJ (§2.5).
 *
 * Estos SÍ están completos, porque HOTFIX.md los lista uno por uno. Van
 * en su propia tabla y no cuelgan de ningún branch: son transversales, y
 * el documento es explícito en que no se infiere un branch padre desde
 * un tag transversal.
 *
 * "70s a 2020s" del documento se expandió a las seis décadas. Es la
 * única lectura razonable de un rango escrito así, pero es una lectura
 * mía y está anotada en PROGRESO.md por si el .docx dice otra cosa.
 */
export type CrossTagKind = "dj_type" | "era" | "contexto" | "formato" | "energia";

export type CrossTag = {
  slug: string;
  name: string;
  kind: CrossTagKind;
  sortOrder: number;
};

function build(kind: CrossTagKind, names: string[], offset: number): CrossTag[] {
  return names.map((name, i) => ({
    slug: slugify(name),
    name,
    kind,
    sortOrder: offset + i,
  }));
}

/** Nombre a slug: sin acentos, sin barras, sin espacios. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const CROSS_TAGS: CrossTag[] = [
  ...build(
    "dj_type",
    [
      "Specialist",
      "Open Format/Crossover",
      "Multi-Genre",
      "Selector/Curator",
      "Turntablist",
      "Live/Hybrid DJ",
    ],
    0
  ),
  ...build(
    "era",
    ["70s", "80s", "90s", "2000s", "2010s", "2020s", "Old School", "Classic", "Current", "Throwbacks"],
    100
  ),
  ...build(
    "contexto",
    [
      "Club",
      "Underground",
      "Warehouse",
      "Festival",
      "Rooftop",
      "Open Air",
      "Afterhours",
      "House Party",
      "Wedding",
      "Corporate",
      "Radio",
    ],
    200
  ),
  ...build(
    "formato",
    [
      "Vinyl",
      "Digital",
      "CDJ",
      "Controller",
      "Live Remixing",
      "Live PA Hybrid",
      "Scratching",
      "Open Format Mixing",
      "Extended Sets",
      "B2B",
    ],
    300
  ),
  ...build(
    "energia",
    [
      "Warm-Up",
      "Peak-Time",
      "Closing",
      "Deep",
      "Dark",
      "Hypnotic",
      "Groovy",
      "Melodic",
      "Hard",
      "Fast",
      "Emotional",
      "Commercial",
      "Experimental",
    ],
    400
  ),
];

/**
 * Reglas del documento que el write path tiene que hacer cumplir. No son
 * CHECK de Postgres porque cuentan filas hermanas, y un CHECK no puede.
 *
 * OJO, HOTFIX.md se contradice sobre el mínimo de tags: §2.3 pide "al
 * menos un tag" para crear la cuenta, y §2.4 pide "de 3 a 8 tags". Acá
 * quedó 3 porque §2.4 es la regla específica de la taxonomía, mientras
 * que §2.3 habla del formulario de alta. Está anotado en PROGRESO.md
 * como decisión pendiente: si el mínimo real al crear la cuenta es 1,
 * se cambia acá y en ningún otro lado.
 */
export const GENRE_RULES = {
  /** Un solo branch primario. Esto SÍ es un índice único parcial. */
  primaryBranches: 1,
  maxSecondaryBranches: 3,
  minTags: 3,
  maxTags: 8,
  /** Los tres primeros tags son los primarios, por orden. */
  primaryTags: 3,
} as const;
