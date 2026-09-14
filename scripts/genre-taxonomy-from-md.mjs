/**
 * Genera lib/genre-taxonomy.ts leyendo GENEROS.md.
 *
 *   node scripts/genre-taxonomy-from-md.mjs
 *
 * GENEROS.md es la fuente de verdad y está pensado para editarse a mano:
 * agregar un tag, corregir un nombre, sumar un branch. Este script vuelve
 * a generar el archivo de TypeScript a partir de él, así que nadie tiene
 * que editar 719 tags en código.
 *
 * Después de correrlo hay que volver a correr /api/seed-genres, que es lo
 * que lleva el vocabulario a la base.
 *
 * Lo que parsea:
 *   "## NN · COD · NOMBRE"   encabezado de branch
 *   "Categoría: X"           su categoría
 *   "- Tag"                  sus tags, hasta el próximo encabezado
 *   "### FAMILIA" + "Clave interna: `kind`" + "- Valor"   cross-tags
 */
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync("GENEROS.md", "utf8").split(/\r?\n/);

/** Nombre a slug: sin acentos, sin barras, sin espacios. */
function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const branches = [];
const tags = [];
const cross = [];

let modo = null;
let actual = null;
let familia = null;

for (let i = 0; i < md.length; i++) {
  const linea = md[i].trim();

  const mBranch = linea.match(/^##\s+(\d{2})\s+·\s+([A-Z]{3})\s+·\s+(.+)$/);
  if (mBranch) {
    modo = "branch";
    familia = null;
    actual = {
      code: mBranch[2],
      name: mBranch[3].trim(),
      category: "",
      sortOrder: Number(mBranch[1]),
    };
    branches.push(actual);
    continue;
  }

  const mFamilia = linea.match(/^###\s+(.+)$/);
  if (mFamilia) {
    modo = "cross";
    actual = null;
    familia = { titulo: mFamilia[1].trim(), kind: null, n: 0 };
    continue;
  }

  // Otro encabezado cualquiera cierra lo que estuviera abierto, para que
  // las listas de "Reglas" o de la tabla no se cuelen como tags.
  if (linea.startsWith("#")) {
    modo = null;
    actual = null;
    familia = null;
    continue;
  }

  if (modo === "branch" && actual) {
    const mCat = linea.match(/^Categoría:\s*(.+)$/);
    if (mCat) {
      actual.category = mCat[1].trim();
      continue;
    }
    if (linea.startsWith("- ")) {
      const name = linea.slice(2).trim();
      tags.push({
        slug: slugify(name),
        name,
        branchCode: actual.code,
        sortOrder: tags.filter((t) => t.branchCode === actual.code).length,
      });
    }
    continue;
  }

  if (modo === "cross" && familia) {
    const mKind = linea.match(/^Clave interna:\s*`([a-z_]+)`$/);
    if (mKind) {
      familia.kind = mKind[1];
      continue;
    }
    if (linea.startsWith("- ") && familia.kind) {
      const name = linea.slice(2).trim();
      const base = { dj_type: 0, era: 100, contexto: 200, formato: 300, energia: 400 }[familia.kind] ?? 0;
      cross.push({ slug: slugify(name), name, kind: familia.kind, sortOrder: base + familia.n });
      familia.n++;
    }
  }
}

// --- chequeos ------------------------------------------------------
// Un tag puede repetirse ENTRE branches, que es intencional. Lo que no
// puede es repetirse DENTRO de uno: la PK es (slug, branch_code).
const vistos = new Set();
const dupes = [];
for (const t of tags) {
  const k = `${t.slug}|${t.branchCode}`;
  if (vistos.has(k)) dupes.push(k);
  vistos.add(k);
}

const crossVistos = new Set();
const crossDupes = [];
for (const c of cross) {
  if (crossVistos.has(c.slug)) crossDupes.push(`${c.slug} (${c.kind})`);
  crossVistos.add(c.slug);
}

if (branches.length !== 34) console.log(`OJO: ${branches.length} branches, se esperaban 34`);
if (dupes.length) {
  console.log("ERROR: tags repetidos dentro del mismo branch (la PK los rechaza):");
  for (const d of dupes) console.log("  " + d);
  process.exit(1);
}
if (crossDupes.length) {
  console.log("ERROR: cross-tags con el mismo slug (la PK es solo slug):");
  for (const d of crossDupes) console.log("  " + d);
  process.exit(1);
}

// --- salida --------------------------------------------------------
const j = (v) => JSON.stringify(v);
const out = [];

out.push("/**");
out.push(" * La taxonomía de géneros (tanda 4, §2).");
out.push(" *");
out.push(" * ============================================================");
out.push(" * GENERADO. NO EDITAR A MANO.");
out.push(" * ============================================================");
out.push(" *");
out.push(" * La fuente es GENEROS.md, en la raíz del repo, que es editable y");
out.push(" * se revisa en un diff. Para cambiar un tag se edita ese archivo y");
out.push(" * se vuelve a correr:");
out.push(" *");
out.push(" *     node scripts/genre-taxonomy-from-md.mjs");
out.push(" *");
out.push(" * y después /api/seed-genres, que es lo que lo lleva a la base.");
out.push(" *");
out.push(` * Hoy: ${branches.length} branches, ${tags.length} tags, ${cross.length} cross-tags.`);
out.push(" *");
out.push(" * Archivo puro: sin base de datos, sin React.");
out.push(" */");
out.push("");
out.push("export type GenreBranch = {");
out.push("  /** Código de 3 letras. Es la PK y lo que guardan los perfiles. */");
out.push("  code: string;");
out.push("  name: string;");
out.push("  category: string;");
out.push("  sortOrder: number;");
out.push("};");
out.push("");
out.push("export type GenreTag = {");
out.push("  slug: string;");
out.push("  name: string;");
out.push("  /** Un tag puede repetirse entre branches: es intencional, y por eso");
out.push("   *  la PK del tag es (slug, branch_code) y no slug solo. */");
out.push("  branchCode: string;");
out.push("  sortOrder: number;");
out.push("};");
out.push("");
out.push("/** Alias de búsqueda. Se busca por el alias, se muestra la canónica. */");
out.push("export type GenreAlias = {");
out.push("  alias: string;");
out.push("  branchCode: string;");
out.push("};");
out.push("");
out.push("export const BRANCHES: GenreBranch[] = [");
for (const b of branches) {
  out.push(
    `  { code: ${j(b.code)}, name: ${j(b.name)}, category: ${j(b.category)}, sortOrder: ${b.sortOrder} },`
  );
}
out.push("];");
out.push("");
out.push("export const TAGS: GenreTag[] = [");
for (const t of tags) {
  out.push(
    `  { slug: ${j(t.slug)}, name: ${j(t.name)}, branchCode: ${j(t.branchCode)}, sortOrder: ${t.sortOrder} },`
  );
}
out.push("];");
out.push("");
out.push("/**");
out.push(" * Los alias que la regla del documento nombra: DnB = Drum & Bass,");
out.push(" * UKG = Garage, Guaracha = Aleteo/Zapateo. Son varias filas porque");
out.push(" * cada forma de escribirlo es un alias distinto al mismo branch.");
out.push(" */");
out.push("export const ALIASES: GenreAlias[] = [");
out.push('  { alias: "DnB", branchCode: "DNB" },');
out.push('  { alias: "Drum and Bass", branchCode: "DNB" },');
out.push('  { alias: "D&B", branchCode: "DNB" },');
out.push('  { alias: "UKG", branchCode: "GAR" },');
out.push('  { alias: "Aleteo", branchCode: "GUA" },');
out.push('  { alias: "Zapateo", branchCode: "GUA" },');
out.push("];");
out.push("");
out.push('export type CrossTagKind = "dj_type" | "era" | "contexto" | "formato" | "energia";');
out.push("");
out.push("export type CrossTag = {");
out.push("  slug: string;");
out.push("  name: string;");
out.push("  kind: CrossTagKind;");
out.push("  sortOrder: number;");
out.push("};");
out.push("");
out.push("/** Era, contexto, formato, energía y tipo de DJ. Van fuera del género");
out.push(" *  y no se infiere un branch padre desde ninguno de ellos. */");
out.push("export const CROSS_TAGS: CrossTag[] = [");
for (const c of cross) {
  out.push(
    `  { slug: ${j(c.slug)}, name: ${j(c.name)}, kind: ${j(c.kind)}, sortOrder: ${c.sortOrder} },`
  );
}
out.push("];");
out.push("");
out.push("/**");
out.push(" * Reglas del documento que el write path tiene que hacer cumplir. No");
out.push(" * son CHECK de Postgres porque cuentan filas hermanas.");
out.push(" *");
out.push(' * El documento dice "Allow 3-8 genre Tags per DJ; rank the first 3 as');
out.push(' * Primary Tags", así que el mínimo es 3 y no 1.');
out.push(" */");
out.push("export const GENRE_RULES = {");
out.push("  /** Un solo branch primario. Esto SÍ es un índice único parcial. */");
out.push("  primaryBranches: 1,");
out.push("  maxSecondaryBranches: 3,");
out.push("  minTags: 3,");
out.push("  maxTags: 8,");
out.push("  /** Los tres primeros tags son los primarios, por orden. */");
out.push("  primaryTags: 3,");
out.push("} as const;");
out.push("");
out.push("/** Nombre a slug: sin acentos, sin barras, sin espacios. */");
out.push("export function slugify(name: string): string {");
out.push("  return name");
out.push('    .normalize("NFD")');
out.push('    .replace(/[\\u0300-\\u036f]/g, "")');
out.push("    .toLowerCase()");
out.push('    .replace(/[^a-z0-9]+/g, "-")');
out.push('    .replace(/^-+|-+$/g, "");');
out.push("}");
out.push("");

writeFileSync("lib/genre-taxonomy.ts", out.join("\n"), "utf8");

console.log(`branches: ${branches.length}`);
console.log(`tags: ${tags.length}`);
console.log(`cross-tags: ${cross.length}`);
const repetidosEntreBranches = tags.length - new Set(tags.map((t) => t.slug)).size;
console.log(`tags con slug repetido entre branches: ${repetidosEntreBranches} (intencional)`);
