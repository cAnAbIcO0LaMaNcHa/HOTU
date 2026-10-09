/**
 * MIGRATION — la tabla `cities`, VACÍA. Los datos los carga un script aparte.
 *
 *   /api/setup-cities?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-cities?secret=YOUR_SECRET
 *
 * ============================================================
 * LA TABLA Y LOS DATOS VIAJAN SEPARADOS, Y NO ES POR PROLIJIDAD
 * ============================================================
 *
 * Son 171.109 ciudades —medido sobre cities1000 de GeoNames; el readme oficial dice ~130.000 y
 * está desactualizado—. Una función de Vercel en plan Hobby corta muchísimo antes de insertar
 * eso, así que la carga NO puede vivir en una ruta.
 *
 * Esta migración crea la forma, que es lo que tiene que estar igual en dev y en main y lo que
 * el comparador de post-deploy vigila. Los datos los pone scripts/cargar-ciudades.mjs, que se
 * corre desde una terminal y pide la cadena de conexión con entrada oculta.
 *
 * ============================================================
 * LA PK ES geonames_id, NO UN SERIAL
 * ============================================================
 *
 * Es la clave del origen, así que una segunda carga ACTUALIZA en vez de duplicar, y dos
 * instalaciones de HOTU hablan de la misma ciudad con el mismo número. Un serial propio
 * obligaría a una tabla de equivalencias contra GeoNames para no perder esa propiedad.
 *
 * ============================================================
 * `clave` ES GENERADA, Y ES LO QUE HACE QUE EL AUTOCOMPLETAR FUNCIONE
 * ============================================================
 *
 * GENERATED ALWAYS AS (...) STORED con el mismo normalizador que ya existe y ya está medido en
 * lib/convocatorias.ts — el que coincide 57/57 con normalizarNombre, incluidas las formas
 * descompuestas. No un tercero.
 *
 * Que sea GENERADA y no escrita es la diferencia: una clave que alguien pueda escribir se
 * desincroniza del nombre, y ese es el modo de falla que ya mordió una vez en convocatorias.
 * Medido que Postgres rechaza escribirla con "cannot insert a non-DEFAULT value".
 *
 * Así "bogota" encuentra "Bogotá" y "Bogotá" encuentra "BOGOTA", que es todo el punto.
 *
 * ============================================================
 * nombre_es ES NULLABLE, Y NULL SIGNIFICA ALGO
 * ============================================================
 *
 * No toda ciudad tiene nombre en español en GeoNames — Londres sí, un pueblo de Finlandia no.
 * NULL dice "no hay", y la UI cae a `nombre`. Rellenarlo copiando `nombre` haría imposible
 * distinguir "se llama igual en español" de "nadie lo tradujo", y el día que GeoNames agregue
 * la traducción nadie sabría cuáles revisar.
 *
 * ============================================================
 * SIN FK A countries
 * ============================================================
 *
 * countries tiene UNA fila —COL— porque es la configuración operativa de donde HOTU funciona,
 * no una lista ISO. Un FK dejaría afuera a las 244 ciudades de los otros países. La lista de
 * países para los filtros es lib/paises.ts, que son 250 con Kosovo y no toca la base.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { normalizarEnSql } from "@/lib/convocatorias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAVE = normalizarEnSql("nombre");

/** [nombre, patrón de tipo, aceptaNull, default exacto] */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["geonames_id", /integer/i, false, null],
  ["nombre", /text/i, false, null],
  ["nombre_es", /text/i, true, null],
  ["country_code", /text/i, false, null],
  ["admin1", /text/i, true, null],
  ["poblacion", /integer/i, false, "0"],
  ["lat", /numeric/i, false, null],
  ["lng", /numeric/i, false, null],
  ["clave", /text/i, true, null],
];

/**
 * Los índices, con su definición EXACTA.
 *
 * cities_pais_clave_idx    el autocompletar: "escribí bogo en Colombia". NO es único — hay
 *                          ciudades distintas con el mismo nombre en el mismo país, y 48
 *                          Springfield en USA no son un error que haya que impedir.
 * cities_pais_poblacion_idx  el orden por relevancia: con 1.173 ciudades colombianas, la
 *                          primera sugerencia tiene que ser Bogotá y no un caserío.
 */
const INDICES: Array<[string, string]> = [
  [
    "cities_pais_clave_idx",
    "CREATE INDEX cities_pais_clave_idx ON public.cities USING btree (country_code, clave)",
  ],
  [
    "cities_pais_poblacion_idx",
    "CREATE INDEX cities_pais_poblacion_idx ON public.cities USING btree (country_code, poblacion DESC)",
  ],
];

const CHECKS: Array<[string, string]> = [
  ["cities_nombre_check", "CHECK ((btrim(nombre) <> ''::text))"],
  ["cities_pais_check", "CHECK ((length(country_code) = 3))"],
  ["cities_poblacion_check", "CHECK ((poblacion >= 0))"],
];

type Forma = {
  existe: boolean;
  columnas: Array<{ nombre: string; tipo: string; aceptaNull: boolean; default: string | null }>;
  generadas: string[];
  indices: string[];
  checks: string[];
};

function verificarForma(f: Forma): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (!f.existe) return { ok: false, problemas: ["falta la tabla cities"] };

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = f.columnas.find((x) => x.nombre === nombre);
    if (!c) {
      p.push(`falta cities.${nombre}`);
      continue;
    }
    if (!patronTipo.test(c.tipo)) p.push(`cities.${nombre} EXISTE PERO es ${c.tipo}`);
    if (c.aceptaNull !== aceptaNull) {
      p.push(`cities.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`);
    }
    if ((c.default ?? null) !== def) {
      p.push(`cities.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`);
    }
  }

  /**
   * Que `clave` sea GENERADA, no solo que exista. Una columna común del mismo tipo pasaría
   * todas las comprobaciones de arriba y dejaría escribir una clave que no corresponde a su
   * nombre — que es exactamente lo que la columna generada impide.
   */
  if (!f.generadas.includes("clave")) {
    p.push("cities.clave EXISTE PERO NO es generada: se podría desincronizar del nombre");
  }

  const exacto = (lista: string[], nombre: string, esperado: string, que: string) => {
    const linea = lista.find((x) => x.startsWith(`${nombre}: `));
    if (!linea) {
      p.push(`falta ${que} ${nombre}`);
      return;
    }
    const real = linea.slice(nombre.length + 2);
    if (real !== esperado) {
      p.push(`${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`);
    }
  };
  for (const [n, d] of INDICES) exacto(f.indices, n, d, "el índice");
  for (const [n, d] of CHECKS) exacto(f.checks, n, d, "el CHECK");

  /** El total de columnas SÍ se fija: esta ruta es la única dueña de esta tabla. */
  if (f.columnas.length !== COLUMNAS.length) {
    p.push(
      `cities tiene ${f.columnas.length} columnas y se esperaban ${COLUMNAS.length} ` +
        `(${f.columnas.map((c) => c.nombre).join(", ")})`
    );
  }

  return { ok: p.length === 0, problemas: p };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const forma = async (): Promise<Forma> => {
    const [t] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'cities'`;
    if (!t) return { existe: false, columnas: [], generadas: [], indices: [], checks: [] };
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default, is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cities' ORDER BY ordinal_position`;
    const idx = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'cities'
        AND indexname <> 'cities_pkey' ORDER BY indexname`;
    const chk = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'cities'::regclass AND contype = 'c' ORDER BY conname`;
    return {
      existe: true,
      columnas: cols.map((c) => ({
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      generadas: cols.filter((c) => c.is_generated === "ALWAYS").map((c) => c.column_name as string),
      indices: idx.map((i) => `${i.indexname}: ${i.indexdef}`),
      checks: chk.map((c) => `${c.conname}: ${c.def}`),
    };
  };

  try {
    const antes = await forma();
    const [n] = antes.existe
      ? await sql(`SELECT COUNT(*)::int AS n FROM cities`)
      : [{ n: 0 }];

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        `SIMULACIÓN. cities ${antes.existe ? `existe con ${n.n} fila(s)` : "NO existe"}. ` +
          "Esta migración crea la tabla VACÍA: las 171.109 ciudades las carga " +
          "scripts/cargar-ciudades.mjs desde una terminal, porque no entran en una función de " +
          "Vercel."
      );
      log.push(v.ok ? "Ya está aplicada." : `Falta aplicar: ${v.problemas.length} problema(s).`);
      for (const x of v.problemas) log.push(`  - ${x}`);
      return NextResponse.json({ ok: true, dryRun: true, verificado: v.ok, problemas: v.problemas, filas: n.n, log });
    }

    await sql(`
      CREATE TABLE IF NOT EXISTS cities (
        geonames_id  INTEGER PRIMARY KEY,
        nombre       TEXT NOT NULL,
        nombre_es    TEXT,
        country_code TEXT NOT NULL,
        admin1       TEXT,
        poblacion    INTEGER NOT NULL DEFAULT 0,
        lat          NUMERIC NOT NULL,
        lng          NUMERIC NOT NULL,
        clave        TEXT GENERATED ALWAYS AS (${CLAVE}) STORED
      )`);

    /**
     * Los ADD COLUMN por si alguien dejó la tabla a medias. El CREATE TABLE de arriba afirma
     * la forma definitiva; esto solo repara, y verificarForma canta si no quedó.
     *
     * clave NO se puede agregar así —una generada no acepta IF NOT EXISTS con expresión en
     * todas las versiones— y por eso se verifica aparte: si falta, el mensaje lo dice.
     */
    await sql.transaction([
      sql(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS nombre_es TEXT`),
      sql(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS admin1 TEXT`),
      sql(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS poblacion INTEGER NOT NULL DEFAULT 0`),
    ]);

    /** CHECK e índices por SWAP, cada uno en su transacción: nunca una ventana sin guarda. */
    for (const [nombre, definicion] of CHECKS) {
      await sql.transaction([
        sql(`ALTER TABLE cities DROP CONSTRAINT IF EXISTS ${nombre}`),
        sql(`ALTER TABLE cities ADD CONSTRAINT ${nombre} ${definicion}`),
      ]);
    }
    for (const [nombre, definicion] of INDICES) {
      await sql.transaction([sql(`DROP INDEX IF EXISTS ${nombre}`), sql(definicion)]);
    }

    const despues = await forma();
    const v = verificarForma(despues);
    const [n2] = await sql(`SELECT COUNT(*)::int AS n FROM cities`);

    log.push(
      v.ok
        ? `VERIFICADO: cities con sus ${COLUMNAS.length} columnas —clave GENERADA—, sus ` +
            `${CHECKS.length} CHECK y sus ${INDICES.length} índices, todos por definición y no ` +
            "por nombre."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);
    log.push(
      n2.n === 0
        ? "La tabla queda VACÍA, como corresponde: los datos los carga el script."
        : `cities tiene ${n2.n} fila(s). Esta migración no inserta ninguna, así que las cargó el script.`
    );

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok,
      conteosEstables: n2.n === n.n,
      problemas: v.problemas,
      filas: n2.n,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
