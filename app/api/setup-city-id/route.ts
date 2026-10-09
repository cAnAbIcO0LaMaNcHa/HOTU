/**
 * MIGRATION — paso 1 de la conversión a city_id: la columna y su FK, sin tocar un dato.
 *
 *   /api/setup-city-id?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-city-id?secret=YOUR_SECRET
 *
 * ============================================================
 * ESTE PASO NO ESCRIBE NI UNA FILA, Y ESA ES LA IDEA
 * ============================================================
 *
 * La regla del repo es "primero dejar de escribir la columna, después borrarla", y acá va en
 * el otro sentido: primero existe la columna nueva, VACÍA y al lado de la vieja, y el texto
 * sigue siendo la fuente de verdad. Recién el paso 2 la llena, el 3 cambia los formularios y
 * el 4 —mucho después— borra el texto.
 *
 * Entre un paso y otro el sitio tiene que seguir funcionando igual. Por eso city_id es
 * NULLABLE: con NOT NULL habría que llenarla en la misma migración, y lo que no empareje
 * —medido: hay un events.city que dice "Calle 80 # 14 - 11"— haría fallar el ALTER sobre una
 * tabla con filas.
 *
 * ============================================================
 * LAS CUATRO TABLAS, Y POR QUÉ artist_gigs TAMBIÉN
 * ============================================================
 *
 *   events       4 filas, 4 con city
 *   artists      18 filas, 18 con city
 *   collectives  9 filas, SIN columna city — acá city_id nace limpio
 *   artist_gigs  0 filas, 0 con city, y SIN country_code
 *
 * collectives nunca llegó a tener la columna de texto: se la saqué a su migración antes de
 * correrla, justamente porque las ciudades pasaron a ser globales. Así que ahí no hay nada que
 * convertir, solo que crear.
 *
 * artist_gigs entra aunque esté vacía porque dejarla afuera significa una quinta migración
 * después. Y su caso es interesante al revés: NO tiene country_code, así que su texto nunca
 * se va a poder emparejar solo —"Córdoba" sin país es Argentina, España o Colombia— y city_id
 * es la única forma de que un toque declarado diga dónde fue sin ambigüedad.
 *
 * ============================================================
 * ON DELETE RESTRICT, NO SET NULL
 * ============================================================
 *
 * cities es dato de referencia que el cargador ACTUALIZA, nunca borra — así que un borrado
 * solo puede ser a mano. Si alguien borra una ciudad que está en uso, SET NULL le vaciaría en
 * silencio el lugar a cada evento que la usaba, y "dónde fue esta fiesta" dejaría de tener
 * respuesta sin que nada chille. RESTRICT lo frena y obliga a mirar.
 *
 * Es el mismo criterio que orders y tickets, por una razón más chica pero de la misma forma:
 * lo que se perdería no se puede reconstruir.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLAS = ["events", "artists", "collectives", "artist_gigs"] as const;

/** La forma EXACTA que Postgres rinde para este FK, medida contra los que ya existen. */
const fkDe = (t: string): [string, string] => [
  `${t}_city_id_fkey`,
  "FOREIGN KEY (city_id) REFERENCES cities(geonames_id) ON DELETE RESTRICT",
];

const indiceDe = (t: string): [string, string] => [
  `${t}_city_id_idx`,
  `CREATE INDEX ${t}_city_id_idx ON public.${t} USING btree (city_id)`,
];

type FormaTabla = {
  existe: boolean;
  cityId: { tipo: string; aceptaNull: boolean; default: string | null } | null;
  fks: string[];
  indices: string[];
  filas: number;
  conCityId: number;
};

function verificar(formas: Record<string, FormaTabla>): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  for (const t of TABLAS) {
    const f = formas[t];
    if (!f.existe) {
      p.push(`falta la tabla ${t}`);
      continue;
    }
    if (!f.cityId) {
      p.push(`falta ${t}.city_id`);
    } else {
      if (!/integer/i.test(f.cityId.tipo)) p.push(`${t}.city_id EXISTE PERO es ${f.cityId.tipo}`);
      /**
       * NULLABLE es parte del contrato de este paso, no un descuido: una city_id NOT NULL
       * acá significaría que alguien la llenó antes de tiempo y que lo que no empareja se
       * perdió o se inventó.
       */
      if (!f.cityId.aceptaNull) p.push(`${t}.city_id es NOT NULL y tiene que ser nullable en este paso`);
      if (f.cityId.default !== null) p.push(`${t}.city_id tiene default ${f.cityId.default} y no debería tener ninguno`);
    }

    const [nFk, dFk] = fkDe(t);
    const lineaFk = f.fks.find((x) => x.startsWith(`${nFk}: `));
    if (!lineaFk) p.push(`falta el FK ${nFk}`);
    else if (lineaFk.slice(nFk.length + 2) !== dFk) {
      p.push(`el FK ${nFk} EXISTE PERO tiene otra definición.\n      es:      ${lineaFk.slice(nFk.length + 2)}\n      debería: ${dFk}`);
    }

    const [nIdx, dIdx] = indiceDe(t);
    const lineaIdx = f.indices.find((x) => x.startsWith(`${nIdx}: `));
    if (!lineaIdx) p.push(`falta el índice ${nIdx}`);
    else if (lineaIdx.slice(nIdx.length + 2) !== dIdx) {
      p.push(`el índice ${nIdx} EXISTE PERO tiene otra definición.\n      es:      ${lineaIdx.slice(nIdx.length + 2)}\n      debería: ${dIdx}`);
    }

    /**
     * Y QUE NO HAYA ESCRITO NADA. Este paso solo crea la columna; si alguna fila viene con
     * city_id, la puso otra cosa, y eso hay que decirlo en vez de dar por buena la corrida.
     */
    if (f.conCityId > 0) {
      p.push(`${t} tiene ${f.conCityId} fila(s) con city_id y este paso no escribe ninguna`);
    }
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

  const estado = async (): Promise<Record<string, FormaTabla>> => {
    const out: Record<string, FormaTabla> = {};
    for (const t of TABLAS) {
      const [existe] = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${t}`;
      if (!existe) {
        out[t] = { existe: false, cityId: null, fks: [], indices: [], filas: 0, conCityId: 0 };
        continue;
      }
      const cols = await sql`
        SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${t} AND column_name = 'city_id'`;
      const fks = await sql`
        SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = ${t}::regclass AND contype = 'f' ORDER BY conname`;
      const idx = await sql`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ${t} ORDER BY indexname`;
      const [n] = await sql(`SELECT COUNT(*)::int AS n FROM ${t}`);
      const conCityId = cols.length > 0
        ? ((await sql(`SELECT COUNT(*)::int AS n FROM ${t} WHERE city_id IS NOT NULL`))[0].n as number)
        : 0;
      out[t] = {
        existe: true,
        cityId: cols.length > 0
          ? {
              tipo: cols[0].data_type as string,
              aceptaNull: cols[0].is_nullable === "YES",
              default: (cols[0].column_default as string | null) ?? null,
            }
          : null,
        fks: fks.map((x) => `${x.conname}: ${x.def}`),
        indices: idx.map((x) => `${x.indexname}: ${x.indexdef}`),
        filas: n.n as number,
        conCityId,
      };
    }
    return out;
  };

  try {
    /** Sin cities no hay a qué apuntar, y el FK fallaría con un error que no explica nada. */
    const [hayCities] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'cities'`;
    if (!hayCities) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Falta la tabla cities, así que el FK no tendría a qué apuntar. Corré " +
            "/api/setup-cities primero, y después cargala con scripts/cargar-ciudades.mjs.",
        },
        { status: 409 }
      );
    }
    const [nCities] = await sql`SELECT COUNT(*)::int AS n FROM cities`;

    const antes = await estado();

    if (dryRun) {
      const v = verificar(antes);
      log.push(
        `SIMULACIÓN. cities tiene ${nCities.n} fila(s). Este paso NO escribe ni una fila: solo ` +
          "crea city_id nullable, su FK y su índice en las cuatro tablas. El texto sigue siendo " +
          "la fuente de verdad hasta el paso 3."
      );
      for (const t of TABLAS) {
        log.push(`  ${t}: ${antes[t].filas} fila(s), ${antes[t].conCityId} con city_id`);
      }
      log.push(v.ok ? "Ya está aplicado." : `Falta aplicar: ${v.problemas.length} problema(s).`);
      for (const x of v.problemas) log.push(`  - ${x}`);
      return NextResponse.json({ ok: true, dryRun: true, verificado: v.ok, problemas: v.problemas, antes, log });
    }

    if (nCities.n === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "cities existe pero está VACÍA. El FK se crearía igual, pero el paso 2 no podría " +
            "emparejar nada y parecería que ninguna ciudad existe. Cargala primero con " +
            "scripts/cargar-ciudades.mjs.",
        },
        { status: 409 }
      );
    }

    for (const t of TABLAS) {
      await sql(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS city_id INTEGER`);
      /**
       * El FK por SWAP dentro de una transacción: DROP IF EXISTS + ADD desnudo. Sin eso hay
       * una ventana de un round-trip sin guarda, y un ADD que falle —una fila con un city_id
       * que no existe en cities— tira foreign_key_violation, que NO es duplicate_object y el
       * envoltorio no atraparía.
       */
      const [nFk, dFk] = fkDe(t);
      await sql.transaction([
        sql(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${nFk}`),
        sql(`ALTER TABLE ${t} ADD CONSTRAINT ${nFk} ${dFk}`),
      ]);
      const [nIdx, dIdx] = indiceDe(t);
      await sql.transaction([sql(`DROP INDEX IF EXISTS ${nIdx}`), sql(dIdx)]);
    }

    const despues = await estado();
    const v = verificar(despues);
    const cambios = TABLAS.filter((t) => despues[t].filas !== antes[t].filas);

    log.push(
      v.ok
        ? `VERIFICADO: las ${TABLAS.length} tablas tienen city_id INTEGER nullable sin default, ` +
            "su FK a cities(geonames_id) ON DELETE RESTRICT y su índice, todos por definición y " +
            "no por nombre. Y ninguna fila quedó con city_id: este paso no escribe datos."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);
    if (cambios.length > 0) {
      log.push(
        `ATENCIÓN: cambió el conteo de ${cambios.join(", ")}. Esta migración no inserta ni borra ` +
          "filas, así que en main lo más probable es tráfico legítimo entre las dos mediciones."
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok,
      conteosEstables: cambios.length === 0,
      problemas: v.problemas,
      antes,
      despues,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
