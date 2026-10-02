/**
 * MIGRATION — se borra la tabla collective_ownership.
 *
 *   /api/setup-borrar-collective-ownership?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-borrar-collective-ownership?secret=YOUR_SECRET
 *
 * ============================================================
 * POR QUÉ SE VA
 * ============================================================
 *
 * profile_ownership la reemplazó en §8, y NO fue un rename: la vieja se dejó viva y
 * congelada a propósito, para que el deploy del código nuevo no tuviera una ventana
 * donde una cesión se escribiera en una tabla y se leyera de la otra. El patrón es
 * el mismo que los tres jsonb — primero dejar de escribir, después borrar.
 *
 * Ya nadie la lee: verificado por grep sobre lib/, app/ y components/, donde no
 * aparece ni una vez fuera de las migraciones que la crearon.
 *
 * ============================================================
 * SE NIEGA SI TIENE FILAS, Y ESO ES EL PUNTO
 * ============================================================
 *
 * PROGRESO.md lo dejó escrito como la condición: si NO está en 0, el código VIEJO
 * escribió una cesión en la ventana entre la migración y el deploy, y esa fila hay
 * que copiarla a profile_ownership ANTES de borrar nada.
 *
 * Así que esta migración NO borra una tabla con datos. Cuenta, y si hay algo
 * devuelve 409 con las filas. Un DROP TABLE que se lleva un registro de quién cedió
 * qué perfil a quién es exactamente el tipo de pérdida que no se nota hasta que
 * alguien pregunta.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "collective_ownership";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const estado = async () => {
    const [existe] = await sql`SELECT 1 FROM pg_class WHERE relname = ${TABLA}`;
    let filas = 0;
    if (existe) {
      const [c] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
      filas = c.n as number;
    }
    const [nueva] = await sql`SELECT COUNT(*)::int AS n FROM profile_ownership`;
    return { existe: Boolean(existe), filas, filasEnProfileOwnership: nueva.n as number };
  };

  try {
    const antes = await estado();

    /**
     * La forma correcta es la AUSENCIA, igual que en setup-borrar-cedula. Es la
     * segunda migración del repo donde verificar es comprobar que algo no está.
     */
    const verificado = !antes.existe;

    if (dryRun) {
      log.push(
        !antes.existe
          ? "SIMULACIÓN: la tabla ya no existe. Correrla no cambiaría nada."
          : antes.filas === 0
            ? "SIMULACIÓN: la tabla existe y está en 0 filas. Se puede borrar sin perder nada."
            : `SIMULACIÓN: la tabla tiene ${antes.filas} fila(s). La corrida real SE VA A NEGAR.`
      );
      log.push(
        `profile_ownership —la que la reemplazó— tiene ${antes.filasEnProfileOwnership} fila(s).`
      );
      log.push("Verificado por grep: ningún código lee collective_ownership fuera de migraciones.");
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado,
        existe: antes.existe,
        filas: antes.filas,
        estado: antes,
        log,
      });
    }

    if (!antes.existe) {
      log.push("La tabla ya no existe: nada que hacer. Idempotente.");
      return NextResponse.json({ ok: true, dryRun: false, verificado: true, antes, log });
    }

    /**
     * LA GUARDA. Si hay filas, son el registro de cesiones que el código viejo
     * escribió en la ventana, y hay que moverlas a mano antes de borrar.
     */
    if (antes.filas > 0) {
      const cuales = await sql(`SELECT * FROM ${TABLA} ORDER BY 1`);
      return NextResponse.json(
        {
          ok: false,
          verificado: false,
          error:
            `${TABLA} tiene ${antes.filas} fila(s) y NO se borra. Son cesiones que el código ` +
            "viejo escribió en la ventana entre la migración y el deploy. Copialas a " +
            "profile_ownership y volvé. No se tocó nada.",
          filas: cuales,
          log,
        },
        { status: 409 }
      );
    }

    await sql(`DROP TABLE ${TABLA}`);
    log.push(`${TABLA} borrada, con 0 filas. profile_ownership queda como la única.`);

    const despues = await estado();
    log.push(
      !despues.existe
        ? "VERIFICADO: la tabla ya no existe."
        : "NO VERIFICADO: la tabla sigue ahí."
    );
    if (despues.filasEnProfileOwnership !== antes.filasEnProfileOwnership) {
      log.push(
        `ATENCIÓN: profile_ownership pasó de ${antes.filasEnProfileOwnership} a ` +
          `${despues.filasEnProfileOwnership} filas. Esta migración no la toca.`
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado:
        !despues.existe &&
        despues.filasEnProfileOwnership === antes.filasEnProfileOwnership,
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
