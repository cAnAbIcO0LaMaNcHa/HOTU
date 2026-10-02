/**
 * MIGRATION — se borran las cuatro columnas congeladas.
 *
 *   /api/setup-borrar-columnas-muertas?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-borrar-columnas-muertas?secret=YOUR_SECRET
 *
 *   artists.sets jsonb              los sets del prototipo
 *   artists.top_tracks jsonb        los tracks del prototipo
 *   collectives.artist_slugs jsonb  las membresías viejas
 *   collectives.status_membership   el estado activo/incompleto de la tanda 3
 *
 * ============================================================
 * ESTO BORRA DATOS, Y NO TODOS SON BASURA
 * ============================================================
 *
 * Las cuatro están congeladas desde hace tandas: nadie las lee ni las escribe,
 * verificado por grep sobre lib/, app/ y components/. Pero NO están vacías, y la
 * diferencia entre ellas importa:
 *
 *   artist_slugs SÍ se migró a artist_collectives, así que lo que tiene es una copia
 *   de algo que vive en otro lado. Borrarla no pierde información.
 *
 *   sets y top_tracks NO se migraron, y fue a propósito: eran placeholders del
 *   prototipo —28 entradas con url "#", sin fecha, sin distrito, sin slug— y
 *   copiarlas a dj_sets/tracks habría metido basura en las tablas buenas. Lo que
 *   tienen no está en ningún otro lugar. Es basura, pero es basura que desaparece
 *   para siempre.
 *
 *   status_membership guardaba un estado que ya no existe como concepto: el mínimo
 *   de 3 DJs se eliminó en la tanda 3 y nadie lo recalcula desde entonces. Lo que
 *   tiene es una foto de una regla derogada.
 *
 * Por eso la migración CUENTA cuántas filas tenían algo en cada una y lo pone en el
 * log antes de borrarlas. "Estaban vacías" es una afirmación que conviene poder
 * hacer con un número, no de memoria.
 *
 * ============================================================
 * LOS CUATRO DROP EN UNA TRANSACCIÓN
 * ============================================================
 *
 * Postgres tiene DDL transaccional incluso entre tablas distintas —medido en este
 * repo, con una transacción de un DDL bueno y uno malo que revirtió el bueno— así
 * que o se van las cuatro o no se va ninguna. Aplicar dos y fallar en la tercera
 * dejaría un estado que nadie eligió y que hay que averiguar.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** tabla, columna, y si lo que guarda existe en otro lado. */
const COLUMNAS: Array<[string, string, string]> = [
  ["artists", "sets", "placeholders del prototipo, NO migrados: se pierden"],
  ["artists", "top_tracks", "placeholders del prototipo, NO migrados: se pierden"],
  ["collectives", "artist_slugs", "migrada a artist_collectives: es una copia"],
  ["collectives", "status_membership", "foto de una regla derogada en tanda 3"],
];

type Estado = {
  presentes: string[];
  conDatos: Record<string, number>;
  filas: Record<string, number>;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p = e.presentes.map((c) => `${c} TODAVÍA EXISTE`);
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
    const presentes: string[] = [];
    const conDatos: Record<string, number> = {};
    for (const [tabla, columna] of COLUMNAS) {
      const [existe] = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tabla} AND column_name = ${columna}`;
      if (!existe) continue;
      presentes.push(`${tabla}.${columna}`);
      /**
       * "Con datos" no es "NOT NULL": un jsonb con '{}' o '[]' está técnicamente
       * lleno y no dice nada. Se cuenta lo que de verdad tiene contenido, porque el
       * número que va al log tiene que significar algo.
       */
      const [c] = await sql(
        `SELECT COUNT(*)::int AS n FROM ${tabla}
         WHERE ${columna} IS NOT NULL AND ${columna}::text NOT IN ('{}', '[]', '')`
      );
      conDatos[`${tabla}.${columna}`] = c.n as number;
    }
    const [a] = await sql`SELECT COUNT(*)::int AS n FROM artists`;
    const [co] = await sql`SELECT COUNT(*)::int AS n FROM collectives`;
    return { presentes, conDatos, filas: { artists: a.n as number, collectives: co.n as number } };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: las cuatro ya no existen. Correrla no cambiaría nada."
          : `SIMULACIÓN: quedan ${antes.presentes.length} columna(s) por borrar.`
      );
      for (const [tabla, columna, nota] of COLUMNAS) {
        const clave = `${tabla}.${columna}`;
        if (!antes.presentes.includes(clave)) {
          log.push(`  ${clave}: ya borrada.`);
          continue;
        }
        log.push(`  ${clave}: ${antes.conDatos[clave]} fila(s) con contenido — ${nota}`);
      }
      log.push("ESTO NO SE PUEDE DESHACER. sets y top_tracks no existen en ningún otro lado.");
      log.push(`Filas: ${JSON.stringify(antes.filas)}. Ninguna puede cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        presentes: antes.presentes,
        conDatos: antes.conDatos,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    if (antes.presentes.length === 0) {
      log.push("Las cuatro ya no existen: nada que hacer. Idempotente.");
      return NextResponse.json({ ok: true, dryRun: false, verificado: true, antes, log });
    }

    /**
     * IF EXISTS en cada DROP para que la idempotencia no dependa de qué se borró en
     * una corrida anterior a medias. Y todas en una transacción, así que "a medias"
     * no debería poder pasar — pero la guarda cuesta una palabra.
     */
    await sql.transaction(
      COLUMNAS.map(([tabla, columna]) =>
        sql(`ALTER TABLE ${tabla} DROP COLUMN IF EXISTS ${columna}`)
      )
    );

    for (const [tabla, columna, nota] of COLUMNAS) {
      const clave = `${tabla}.${columna}`;
      const tenia = antes.conDatos[clave];
      if (tenia === undefined) continue;
      log.push(`BORRADA ${clave}, que tenía ${tenia} fila(s) con contenido — ${nota}`);
    }

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? "VERIFICADO: las cuatro columnas ya no existen."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.filas).filter((k) => despues.filas[k] !== antes.filas[k]);
    if (cambiaron.length > 0) {
      log.push(`ATENCIÓN: cambió el conteo de ${cambiaron.join(", ")}. Esto no borra filas.`);
    } else {
      log.push(`Las filas siguen todas: ${JSON.stringify(despues.filas)}.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && cambiaron.length === 0,
      borradas: antes.presentes,
      teniaDatos: antes.conDatos,
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
