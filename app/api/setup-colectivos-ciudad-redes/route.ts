/**
 * MIGRATION — collectives.city y collectives.socials.
 *
 *   /api/setup-colectivos-ciudad-redes?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-colectivos-ciudad-redes?secret=YOUR_SECRET
 *
 * ============================================================
 * LOS DOS TRAMOS EN UNA RUTA, Y POR QUÉ NO SON DOS
 * ============================================================
 *
 * Son la misma tabla, las dos columnas son nullable y ninguna tiene backfill. Partirlo en dos
 * rutas haría correr dos veces el mismo swap de constraints sobre collectives para no ganar
 * nada: lo que justifica separar tramos es que tengan RIESGOS distintos, y estos dos tienen el
 * mismo — ninguno.
 *
 * ============================================================
 * city: LA PROMESA DE LA PIEZA 4, QUE VENCÍA
 * ============================================================
 *
 * AGENTS.md dice, textual: "sector ya NO agrupa nada (tanda 3). Es una etiqueta de origen
 * dentro de la tarjeta. La ciudad de verdad llega con la pieza 4." Esta es esa columna.
 *
 * SIN BACKFILL DESDE sector, y es la decisión que importa acá. sector tiene valores que
 * PARECEN ciudades —Bogotá, Cali, Medellín, Pereira— y copiarlos sería afirmar que el sector
 * ES la ciudad, que es justo lo que el archivo dice que no. Un colectivo cuyo sector dice
 * "Bogotá" puede operar en Chía. Lo carga el dueño.
 *
 * Por eso es NULLABLE: NULL significa "todavía no dijo", que es cierto para las 9 filas de dev
 * y las 11 de main. Una cadena vacía no podría distinguir eso de "dijo que no tiene".
 *
 * ============================================================
 * socials: LA MISMA FORMA QUE artists.socials
 * ============================================================
 *
 * jsonb NOT NULL DEFAULT '{}', con un CHECK de que sea un OBJETO y no un array ni un número.
 * Sin el CHECK, un `socials: []` entraría y el lector que hace Object.entries() devolvería
 * vacío sin error — el dueño cargaría sus redes y no aparecerían, sin nada que lo explique.
 *
 * NO lleva CHECK de qué plataformas valen. Son diez hoy y la lista cambia; un CHECK obligaría
 * a una migración por cada red nueva, y el costo de una clave de más es un ícono que no se
 * pinta, no un dato roto.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "collectives";

/** [nombre, patrón de tipo, aceptaNull, default exacto] — medido, no supuesto. */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["city", /text/i, true, null],
  ["socials", /jsonb/i, false, "'{}'::jsonb"],
];

const CHECKS: Array<[string, string]> = [
  [
    `${TABLA}_city_check`,
    "CHECK (((city IS NULL) OR (btrim(city, ' \t\r\n\u00A0'::text) <> ''::text)))",
  ],
  [`${TABLA}_socials_objeto_check`, "CHECK ((jsonb_typeof(socials) = 'object'::text))"],
];

type Forma = {
  existe: boolean;
  columnas: Array<{ nombre: string; tipo: string; aceptaNull: boolean; default: string | null }>;
  checks: string[];
};
type Estado = { forma: Forma; filas: number; conCiudad: number };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (!e.forma.existe) {
    p.push(`falta la tabla ${TABLA}`);
    return { ok: false, problemas: p };
  }

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = e.forma.columnas.find((x) => x.nombre === nombre);
    if (!c) {
      p.push(`falta ${TABLA}.${nombre}`);
      continue;
    }
    if (!patronTipo.test(c.tipo)) p.push(`${TABLA}.${nombre} EXISTE PERO es ${c.tipo}`);
    if (c.aceptaNull !== aceptaNull) {
      p.push(
        `${TABLA}.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`
      );
    }
    if ((c.default ?? null) !== def) {
      p.push(
        `${TABLA}.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`
      );
    }
  }

  for (const [nombre, definicion] of CHECKS) {
    const linea = e.forma.checks.find((x) => x.startsWith(`${nombre}: `));
    if (!linea) {
      p.push(`falta el CHECK ${nombre} en ${TABLA}`);
      continue;
    }
    const real = linea.slice(nombre.length + 2);
    if (real !== definicion) {
      p.push(
        `el CHECK ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${definicion}`
      );
    }
  }

  /**
   * NO SE FIJA EL TOTAL DE COLUMNAS NI DE CHECK de collectives, y es deliberado: esta tabla la
   * creó otra migración y la tocaron varias más —entity_kind, address, capacity, la censura—.
   * Contar su total acá sería una segunda definición de la forma de una tabla ajena, que es lo
   * que ya rompió setup-convocatorias cuando visibilidad le agregó una columna.
   *
   * Lo que sí se exige es que estén las dos que esta ruta crea, con su forma exacta.
   */
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

  const estado = async (): Promise<Estado> => {
    const [t] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${TABLA}`;
    if (!t) return { forma: { existe: false, columnas: [], checks: [] }, filas: 0, conCiudad: 0 };

    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${TABLA}
      ORDER BY ordinal_position`;
    const checks = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = ${TABLA}::regclass AND contype = 'c'
      ORDER BY conname`;
    const [n] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);

    /** Cuántas ya tienen ciudad, si la columna existe. Es lo que prueba que no hubo backfill. */
    let conCiudad = 0;
    if (cols.some((c) => c.column_name === "city")) {
      const [cc] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA} WHERE city IS NOT NULL`);
      conCiudad = cc.n as number;
    }

    return {
      forma: {
        existe: true,
        columnas: cols.map((c) => ({
          nombre: c.column_name as string,
          tipo: c.data_type as string,
          aceptaNull: c.is_nullable === "YES",
          default: (c.column_default as string | null) ?? null,
        })),
        checks: checks.map((c) => `${c.conname}: ${c.def}`),
      },
      filas: n.n as number,
      conCiudad,
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        `SIMULACIÓN. ${TABLA} tiene ${antes.filas} fila(s). No hay backfill: city entra en NULL ` +
          "para todas y NO se copia de sector, porque sector es una etiqueta de origen y no la " +
          "ciudad. socials entra con su default '{}', que Postgres aplica a las existentes."
      );
      log.push(v.ok ? "Ya está aplicada." : `Falta aplicar: ${v.problemas.length} problema(s).`);
      for (const x of v.problemas) log.push(`  - ${x}`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        antes,
        log,
      });
    }

    if (!antes.forma.existe) {
      return NextResponse.json({ ok: false, error: `Falta la tabla ${TABLA}.` }, { status: 409 });
    }

    /**
     * Los dos ADD COLUMN en UNA transacción: o las dos columnas o ninguna. Lo que falla sobre
     * una tabla con filas es un ADD COLUMN NOT NULL *sin* default; socials lo tiene y city es
     * nullable, así que ninguno puede fallar por las filas existentes.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS city TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '{}'::jsonb`),
    ]);

    /**
     * Y los CHECK por SWAP, cada uno en su transacción: DROP IF EXISTS + ADD desnudo. Sin la
     * transacción hay una ventana de un round-trip sin guarda, y si el ADD falla —una fila con
     * un valor que el CHECK nuevo no acepta tira check_violation, que NO es duplicate_object—
     * la ventana no se cierra nunca.
     */
    for (const [nombre, definicion] of CHECKS) {
      await sql.transaction([
        sql(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${nombre}`),
        sql(`ALTER TABLE ${TABLA} ADD CONSTRAINT ${nombre} ${definicion}`),
      ]);
    }

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: ${TABLA}.city es TEXT nullable sin default y ${TABLA}.socials es JSONB ` +
            "NOT NULL DEFAULT '{}', con sus dos CHECK verificados por definición y no por nombre."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    /**
     * Y SE MIDE QUE NO HUBO BACKFILL. "No copia sector" es una afirmación hasta que el número
     * la respalda: si alguna fila quedara con ciudad, alguien la escribió.
     */
    log.push(
      despues.conCiudad === 0
        ? `Sin backfill, medido: 0 de ${despues.filas} fila(s) tienen city. La carga el dueño.`
        : `ATENCIÓN: ${despues.conCiudad} fila(s) ya tienen city. Esta migración no escribe ` +
            "ninguna, así que alguien más las puso."
    );

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok,
      conteosEstables: despues.filas === antes.filas,
      sinBackfill: despues.conCiudad === 0,
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
