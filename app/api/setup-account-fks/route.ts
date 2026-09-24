/**
 * MIGRATION — las tres FK que faltan contra user_profiles (§8).
 *
 *   /api/setup-account-fks?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-account-fks?secret=YOUR_SECRET
 *
 * PURAMENTE ADITIVA, SIN BACKFILL Y SIN TOCAR UNA SOLA FILA. Tres
 * constraints y nada más.
 *
 * ============================================================
 * EL AGUJERO QUE CIERRA, Y QUE EXISTE HOY
 * ============================================================
 *
 * orders.user_email, tickets.user_email y user_roles.email nombran una
 * cuenta y NO tienen FK. Medido, no supuesto. Consecuencias que ya están
 * activas:
 *
 *   user_roles  — EL ROL SOBREVIVE A LA CUENTA. Si se borra la cuenta de
 *                 un moderador y después alguien registra ese email,
 *                 HEREDA EL ROL: isSuperAdmin consulta user_roles por
 *                 email sin mirar si la cuenta existe, y /api/accounts es
 *                 público. Es el más grave de los tres y no necesita que
 *                 exista el borrado de cuentas para pasar.
 *   tickets     — la prueba de un pago apuntando a nadie.
 *   orders      — un registro financiero sin contraparte.
 *
 * ============================================================
 * POR QUÉ RESTRICT EN DOS Y CASCADE EN LA OTRA
 * ============================================================
 *
 * orders y tickets van RESTRICT: la base NIEGA borrar una cuenta que
 * tenga pedidos o boletas. Una boleta es prueba de un pago, y lo que hay
 * que hacer con esa cuenta es BANEARLA, no borrarla. Poner esa regla en
 * el schema y no en el código es la diferencia entre que sea imposible y
 * que dependa de que alguien se acuerde.
 *
 * user_roles va CASCADE: el rol es una concesión a una persona, no un
 * registro histórico. Si la cuenta se va, el rol se va con ella, que es
 * exactamente lo que hoy no pasa.
 *
 * ============================================================
 * LOS HUÉRFANOS SE REPORTAN, NO SE ARREGLAN
 * ============================================================
 *
 * Si ya hay filas que apuntan a cuentas inexistentes, el ADD CONSTRAINT
 * falla. Esta ruta las DETECTA ANTES y se niega con la lista, en vez de
 * dejar que Postgres tire un foreign_key_violation crudo.
 *
 * Y no las borra. Qué hacer con una boleta cuyo comprador ya no existe es
 * una decisión sobre plata, no una limpieza que una migración deba tomar
 * sola.
 *
 * OJO CON LAS MAYÚSCULAS: un FK compara EXACTO. Una fila cuyo email
 * coincida en minúsculas pero no carácter a carácter pasa cualquier
 * chequeo con lower() y hace fallar el ALTER igual. Por eso se miden las
 * dos cosas y se reportan por separado.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** tabla, columna, nombre del constraint, acción al borrar. */
const FKS: Array<[string, string, string, "RESTRICT" | "CASCADE"]> = [
  ["orders", "user_email", "orders_user_email_fkey", "RESTRICT"],
  ["tickets", "user_email", "tickets_user_email_fkey", "RESTRICT"],
  ["user_roles", "email", "user_roles_email_fkey", "CASCADE"],
];

const definicionEsperada = (columna: string, onDelete: string) =>
  `FOREIGN KEY (${columna}) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE ${onDelete}`;

type Huerfano = { quien: string; filas: number };
type Estado = {
  constraints: Record<string, string | null>;
  /** Las que el FK rechazaría: comparación EXACTA, que es la que él hace. */
  huerfanos: Record<string, Huerfano[]>;
  /** Las que solo difieren en mayúsculas: pasan un lower() y rompen el ALTER. */
  soloPorMayusculas: Record<string, Huerfano[]>;
  conteos: Record<string, number>;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  for (const [tabla, columna, nombre, onDelete] of FKS) {
    const real = e.constraints[nombre] ?? null;
    const esperado = definicionEsperada(columna, onDelete);
    if (real === null) p.push(`falta el FK ${nombre} en ${tabla}`);
    else if (real !== esperado) {
      p.push(
        `el FK ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
      );
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

  const estado = async (): Promise<Estado> => {
    const constraints: Record<string, string | null> = {};
    const huerfanos: Record<string, Huerfano[]> = {};
    const soloPorMayusculas: Record<string, Huerfano[]> = {};
    const conteos: Record<string, number> = {};

    for (const [tabla, columna, nombre] of FKS) {
      // conrelid ADEMÁS del nombre: los nombres de constraint no son
      // únicos en el esquema, solo por tabla. Sin el filtro, dos tablas
      // con un constraint del mismo nombre devuelven dos filas y el
      // [c] se queda con la primera en orden arbitrario de oid — podría
      // certificar la forma de un constraint ajeno.
      const [c] = await sql`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = ${nombre} AND conrelid = ${tabla}::regclass
      `;
      constraints[nombre] = (c?.def as string | undefined) ?? null;

      // Lo que el FK rechazaría: igualdad EXACTA.
      const exactos = await sql(
        `SELECT x.${columna} AS quien, count(*)::int AS n
         FROM ${tabla} x
         LEFT JOIN user_profiles u ON u.email = x.${columna}
         WHERE x.${columna} IS NOT NULL AND u.email IS NULL
         GROUP BY x.${columna} ORDER BY n DESC`
      );
      huerfanos[`${tabla}.${columna}`] = exactos.map((r) => ({
        quien: r.quien as string,
        filas: Number(r.n),
      }));

      // De esos, los que SÍ existen ignorando mayúsculas: no son cuentas
      // borradas, son el mismo email escrito distinto. Se separan porque
      // la respuesta es otra — ahí lo que hay que arreglar es la
      // capitalización, no decidir qué hacer con la plata de nadie.
      const casing = await sql(
        `SELECT x.${columna} AS quien, count(*)::int AS n
         FROM ${tabla} x
         WHERE x.${columna} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM user_profiles u WHERE u.email = x.${columna})
           AND EXISTS (SELECT 1 FROM user_profiles u WHERE lower(u.email) = lower(x.${columna}))
         GROUP BY x.${columna} ORDER BY n DESC`
      );
      soloPorMayusculas[`${tabla}.${columna}`] = casing.map((r) => ({
        quien: r.quien as string,
        filas: Number(r.n),
      }));

      const [n] = await sql(`SELECT count(*)::int AS n FROM ${tabla}`);
      conteos[`filas_${tabla}`] = n.n as number;
    }
    const [u] = await sql`SELECT count(*)::int AS n FROM user_profiles`;
    conteos.filas_user_profiles = u.n as number;
    return { constraints, huerfanos, soloPorMayusculas, conteos };
  };

  const listarHuerfanos = (e: Estado, log: string[]): number => {
    let total = 0;
    for (const [tabla, columna] of FKS.map(([t, c]) => [t, c])) {
      const k = `${tabla}.${columna}`;
      const h = e.huerfanos[k] ?? [];
      const m = e.soloPorMayusculas[k] ?? [];
      const n = h.reduce((s, x) => s + x.filas, 0);
      total += n;
      log.push(`  ${k}: ${n} fila(s) apuntando a una cuenta que no existe.`);
      for (const x of h) {
        const porMayusculas = m.some((y) => y.quien === x.quien);
        log.push(
          `      ${x.quien} -> ${x.filas} fila(s)` +
            (porMayusculas ? "   [SOLO DIFIERE EN MAYÚSCULAS: la cuenta existe escrita distinto]" : "")
        );
      }
    }
    return total;
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: los tres FK ya están con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);

      log.push("");
      log.push("HUÉRFANOS — lo que hay que mirar ANTES de correrla:");
      const total = listarHuerfanos(antes, log);
      log.push(
        total === 0
          ? "  TOTAL 0. La migración puede correr."
          : `  TOTAL ${total}. LA MIGRACIÓN NO VA A CORRER hasta que se resuelvan: un ADD CONSTRAINT sobre filas huérfanas falla. No se borran ni se arreglan solas.`
      );
      log.push("");
      log.push(
        "NO TOCA NINGUNA FILA: solo agrega constraints. orders y tickets con RESTRICT, user_roles con CASCADE."
      );
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. No pueden cambiar.`);

      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        huerfanos: total,
        estado: antes,
        log,
      });
    }

    /* ============ la guarda: huérfanos primero ============ */
    const total = listarHuerfanos(antes, []);
    if (total > 0) {
      const detalle: string[] = [];
      listarHuerfanos(antes, detalle);
      return NextResponse.json(
        {
          ok: false,
          verificado: false,
          error:
            `Hay ${total} fila(s) apuntando a cuentas que no existen. El ADD CONSTRAINT fallaría. ` +
            "No se tocó nada: revisá la lista y decidí qué hacer con cada una.",
          huerfanos: antes.huerfanos,
          soloPorMayusculas: antes.soloPorMayusculas,
          log: [...log, ...detalle],
        },
        { status: 409 }
      );
    }

    /* ============ los tres FK, por swap ============
     * DROP IF EXISTS + ADD desnudo en una transacción, como el resto del
     * repo: cada corrida RE-AFIRMA la definición en vez de confiar en
     * que la primera la dejó bien, y si una fila la violara el ADD tira
     * ruidosamente y la transacción deja la tabla como estaba.
     */
    for (const [tabla, columna, nombre, onDelete] of FKS) {
      await sql.transaction([
        sql(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`),
        sql(
          `ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} FOREIGN KEY (${columna}) ` +
            `REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE ${onDelete}`
        ),
      ]);
    }

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? "VERIFICADO: los tres FK quedaron con la forma esperada — orders y tickets RESTRICT, user_roles CASCADE."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(despues.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe filas, ` +
          "así que en main lo más probable es una venta o un alta que entró entre las dos " +
          "mediciones. Si los números se mueven en filas_* y los FK quedaron verificados, no es corrupción."
      );
    } else {
      log.push(`Sin cambios en los datos: ${JSON.stringify(despues.conteos)}.`);
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && cambiaron.length === 0,
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
