/**
 * MIGRATION — se vacía y se borra user_profiles.cedula.
 *
 *   /api/setup-borrar-cedula?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-borrar-cedula?secret=YOUR_SECRET
 *
 * ============================================================
 * ESTO BORRA DATOS A PROPÓSITO, Y NO SE PUEDE DESHACER
 * ============================================================
 *
 * Es el único sentido de esta migración: la cédula es dato sensible bajo la Ley
 * 1581 de 2012 y HOTU decidió no guardarla — para verificar mayoría de edad basta
 * birth_date, que existe desde la tanda 1.
 *
 * El orden de la deprecación era: primero dejar de escribirla, después limpiarla.
 * La primera mitad está hecha desde hace tandas —verificado por grep: NADA en el
 * código la lee ni la escribe, solo hay comentarios que dicen que no se usa— así
 * que esta es la segunda.
 *
 * ============================================================
 * SE VACÍA ANTES DE BORRAR, Y NO ES REDUNDANTE
 * ============================================================
 *
 * Sí, el DROP COLUMN se lleva los datos igual. El UPDATE previo existe por UNA
 * razón: CUENTA. Con RETURNING se sabe CUÁNTAS filas tenían cédula, y eso queda en
 * el log. Sin ese paso la columna desaparece y nadie va a saber nunca cuántos
 * datos sensibles había — que es justamente lo que uno quiere poder decir después
 * de borrarlos.
 *
 * Los dos pasos van en UNA transacción: o se vacía y se borra, o no pasa nada.
 *
 * LA PRIMERA VERSIÓN DE ESTE COMENTARIO DABA UNA SEGUNDA RAZÓN Y ERA FALSA, así
 * que queda escrito para que nadie la reponga: decía que si el DROP fallaba, "los
 * datos ya no están" y que fallar hacia borrado era el lado correcto. No es lo que
 * pasa. La transacción es real —el driver manda las dos queries en un solo POST y
 * Neon las corre juntas— así que si el DROP falla, el UPDATE se revierte con él y
 * la cédula queda INTACTA. Un reintento encuentra la fila como estaba.
 *
 * Importa porque alguien podría leer esa frase y confiar en que, ante una falla,
 * al menos el dato sensible ya se fue. No se fue. La atomicidad es el
 * comportamiento seguro, pero es el comportamiento CONTRARIO al que decía el
 * comentario, y en un archivo que borra algo irreversible una afirmación falsa
 * sobre el mecanismo es peor que ninguna.
 *
 * ============================================================
 * IDEMPOTENTE, Y LA SEGUNDA CORRIDA NO TIENE NADA QUE HACER
 * ============================================================
 *
 * Si la columna ya no existe, la migración devuelve ok y verificado en true sin
 * tocar nada. No es un caso de borde: la regla del repo es correr toda migración
 * dos veces, y la segunda pasada de ESTA encuentra la columna ausente.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Estado = {
  existeColumna: boolean;
  conCedula: number;
  cuentas: number;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  /**
   * La forma correcta es LA AUSENCIA. Es la única migración del repo donde
   * verificar es comprobar que algo NO está.
   */
  if (e.existeColumna) p.push("user_profiles.cedula TODAVÍA EXISTE");
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
    const [col] = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'cedula'`;
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM user_profiles`;
    let conCedula = 0;
    if (col) {
      const [x] = await sql`SELECT COUNT(*)::int AS n FROM user_profiles WHERE cedula IS NOT NULL`;
      conCedula = x.n as number;
    }
    return { existeColumna: Boolean(col), conCedula, cuentas: c.n as number };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: la columna ya no existe. Correrla no cambiaría nada."
          : `SIMULACIÓN: la columna existe y hay ${antes.conCedula} fila(s) con cédula. ` +
            "La corrida real las va a BORRAR y va a quitar la columna."
      );
      log.push("ESTO NO SE PUEDE DESHACER. La cédula es dato sensible (Ley 1581) y no se guarda.");
      log.push("Verificado por grep: ningún código lee ni escribe cedula. Solo quedan comentarios.");
      log.push(`Cuentas en total: ${antes.cuentas}. Ese número NO puede cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        columnaExiste: antes.existeColumna,
        filasConCedula: antes.conCedula,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    if (!antes.existeColumna) {
      log.push("La columna ya no existe: no hay nada que hacer. Idempotente.");
      const v = verificarForma(antes);
      return NextResponse.json({
        ok: true,
        dryRun: false,
        verificado: v.ok,
        vaciadas: 0,
        problemas: v.problemas,
        antes,
        despues: antes,
        log,
      });
    }

    /**
     * EL UPDATE CON RETURNING VA PRIMERO PARA PODER CONTAR, y el DROP después, los
     * dos en la misma transacción. sql.transaction devuelve el resultado de cada
     * sentencia, así que la cuenta sale del mismo viaje que el borrado — no hay una
     * ventana donde se cuente una cosa y se borre otra.
     */
    const [vaciadas] = await sql.transaction([
      sql`UPDATE user_profiles SET cedula = NULL WHERE cedula IS NOT NULL RETURNING email`,
      sql`ALTER TABLE user_profiles DROP COLUMN cedula`,
    ]);

    const cuantas = Array.isArray(vaciadas) ? vaciadas.length : 0;
    log.push(`VACIADAS ${cuantas} fila(s) con cédula, y después la columna se quitó.`);
    log.push("Contado con RETURNING: sin esto, la columna desaparecía y nadie iba a saber cuántas había.");

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? "VERIFICADO: user_profiles.cedula ya no existe."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    if (despues.cuentas !== antes.cuentas) {
      log.push(
        `ATENCIÓN: las cuentas pasaron de ${antes.cuentas} a ${despues.cuentas}. ` +
          "Esta migración NO borra cuentas."
      );
    } else {
      log.push(`Las ${despues.cuentas} cuentas siguen todas. Solo se fue la columna.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && despues.cuentas === antes.cuentas,
      vaciadas: cuantas,
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
