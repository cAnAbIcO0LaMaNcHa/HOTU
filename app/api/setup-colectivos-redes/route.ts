/**
 * MIGRATION — collectives.socials.
 *
 *   /api/setup-colectivos-redes?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-colectivos-redes?secret=YOUR_SECRET
 *
 * ============================================================
 * ESTA RUTA TENÍA UNA COLUMNA MÁS Y SE LA SAQUÉ ANTES DE CORRERLA
 * ============================================================
 *
 * Se llamaba setup-colectivos-ciudad-redes y agregaba también collectives.city TEXT. Las
 * ciudades pasaron a ser globales con GeoNames, así que la ciudad va a ser city_id con FK a
 * una tabla cities, y no texto libre.
 *
 * Dejar la columna de texto igual habría costado CUATRO migraciones para CERO datos:
 * crearla, crear city_id, un backfill que no mapea nada porque está vacía, y borrarla — que
 * por la regla del repo es su propia migración, nunca la misma que deja de usarla.
 *
 * Y sacarla es gratis porque está MEDIDO que no hay nada que preservar: collectives.city
 * está en 0 filas en dev y no existe en main, donde esta ruta todavía no corrió. Una columna
 * CON datos habría exigido la transición por etapas en vez de este borrado.
 *
 * socials no tiene nada que ver con ciudades y se queda tal cual.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "collectives";

/** [nombre, patrón de tipo, aceptaNull, default exacto] — medido, no supuesto. */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["socials", /jsonb/i, false, "'{}'::jsonb"],
];

const CHECKS: Array<[string, string]> = [
  [`${TABLA}_socials_objeto_check`, "CHECK ((jsonb_typeof(socials) = 'object'::text))"],
];

type Forma = {
  existe: boolean;
  columnas: Array<{ nombre: string; tipo: string; aceptaNull: boolean; default: string | null }>;
  checks: string[];
};
type Estado = { forma: Forma; filas: number };

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
    if (!t) return { forma: { existe: false, columnas: [], checks: [] }, filas: 0 };

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
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        `SIMULACIÓN. ${TABLA} tiene ${antes.filas} fila(s). Sin backfill: socials entra con su ` +
          "default '{}', que Postgres aplica a las filas existentes sin tocarlas una por una."
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
     * UN solo ADD COLUMN, así que no hace falta transacción: una sola sentencia ya es atómica.
     * Lo que falla sobre
     * una tabla con filas es un ADD COLUMN NOT NULL *sin* default; socials lo tiene, así que
     * no puede fallar por las filas existentes.
     */
    await sql(
      `ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '{}'::jsonb`
    );

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
        ? `VERIFICADO: ${TABLA}.socials es JSONB NOT NULL DEFAULT '{}', con su CHECK de que sea ` +
            "un objeto verificado por definición y no por nombre."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok,
      conteosEstables: despues.filas === antes.filas,
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
