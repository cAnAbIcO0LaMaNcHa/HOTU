/**
 * MIGRATION — events.door_price_cop: el precio en taquilla, informativo.
 *
 *   /api/setup-door-price?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-door-price?secret=YOUR_SECRET
 *
 * UNA COLUMNA Y UN CHECK. Sin backfill.
 *
 * ============================================================
 * QUÉ ES, Y SOBRE TODO QUÉ NO ES
 * ============================================================
 *
 * Es el precio que el organizador cobra EN LA PUERTA, para mostrarlo en la
 * página del evento como "Taquilla: $35.000". Nada más.
 *
 * NO es un precio de venta. La venta online está apagada por VENTA_ONLINE y la
 * atribución de ventas quedó pospuesta, así que esta columna no participa de
 * ningún cobro: no la lee el carrito, no la lee el checkout, y no tiene
 * relación con order_items.unit_price_cop, que es el precio que de verdad se
 * cobró y vive en otra tabla por una razón —lo que se cobró es un hecho de una
 * compra concreta, y esto es lo que el organizador dice que cuesta entrar—.
 *
 * Conviene dejarlo escrito porque la confusión sería costosa en un sentido
 * puntual: si algún día el cobro online se enciende, esta columna NO puede
 * convertirse en el precio de venta por conveniencia. Un anuncio y un cobro son
 * cosas distintas, y el día que se cobre hará falta decidir tiers, cupos y
 * fechas de corte, que es justamente lo que esta columna no tiene.
 *
 * ============================================================
 * NULLABLE, Y NULL SIGNIFICA ALGO
 * ============================================================
 *
 * NULL = el organizador no dijo precio, y entonces la página no muestra NADA.
 * No muestra "$0", no muestra "gratis", no muestra "a confirmar": no dijo nada
 * y el sitio no habla por él. Un evento gratuito es un evento que dice 0, y
 * para eso el CHECK deja pasar 0.
 *
 * Sin DEFAULT a propósito. Un default convertiría "no dijo" en un precio, y
 * los 20 eventos que ya existen nacerían anunciando algo que nadie escribió.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "events";
const COLUMNA = "door_price_cop";
const CHECK = `${TABLA}_door_price_check`;

/**
 * Acepta 0 —gratis es un precio que alguien puede querer anunciar— y rechaza
 * negativos.
 *
 * EL TECHO NO ATAJA TIPEOS, Y DECIRLO IMPORTA porque la primera versión de este
 * comentario prometía justamente eso. Un cero de más sobre un precio normal da
 * 350.000, que es un precio perfectamente posible: ningún CHECK puede
 * distinguir un tipeo de una decisión. Lo que el techo ataja es otra cosa, más
 * chica y todavía útil: un número que NO PUEDE SER un precio de entrada.
 *
 * 10.000.000 COP son unos USD 2.500. Ninguna entrada de fiesta en Bogotá cuesta
 * eso, y un valor por encima es casi seguro un campo mal usado —una cédula, un
 * teléfono, un id— más que una decisión de precio. Es una guarda de tipo, no de
 * criterio.
 */
const DEF_CHECK =
  `CHECK (((${COLUMNA} IS NULL) OR ((${COLUMNA} >= 0) AND (${COLUMNA} <= 10000000))))`;

type Estado = {
  columna: { tipo: string; aceptaNull: boolean; default: string | null } | null;
  checks: string[];
  conteos: Record<string, number>;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  if (!e.columna) {
    p.push(`falta ${TABLA}.${COLUMNA}`);
  } else {
    if (!/integer/i.test(e.columna.tipo)) {
      p.push(`${TABLA}.${COLUMNA} EXISTE PERO es ${e.columna.tipo} y se esperaba integer`);
    }
    if (!e.columna.aceptaNull) {
      p.push(`${TABLA}.${COLUMNA} es NOT NULL y tiene que aceptar NULL ("no dijo precio")`);
    }
    /**
     * Se compara contra "ninguno" y no contra "tiene alguno". Un ADD COLUMN IF
     * NOT EXISTS sobre una columna preexistente CON default no hace nada y no
     * falla, y esa columna anunciaría un precio en cada evento viejo.
     */
    if (e.columna.default !== null) {
      p.push(
        `${TABLA}.${COLUMNA} tiene default ${e.columna.default} y NO debe tener ninguno: ` +
          "un default convierte \"no dijo\" en un precio"
      );
    }
  }

  const linea = e.checks.find((x) => x.startsWith(`${CHECK}: `));
  if (!linea) {
    p.push(`falta el CHECK ${CHECK}`);
  } else {
    const real = linea.slice(CHECK.length + 2);
    if (real !== DEF_CHECK) {
      p.push(
        `el CHECK ${CHECK} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${DEF_CHECK}`
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
    const cols = await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${TABLA} AND column_name = ${COLUMNA}
    `;
    const cons = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = ${TABLA}::regclass AND contype = 'c' ORDER BY conname
    `;
    const [total] = await sql`SELECT COUNT(*)::int AS n FROM events`;
    /**
     * Cuántos eventos tienen precio. Arranca en 0 y la migración no puede
     * moverlo: si sube, alguien escribió precios y esta migración no escribe
     * ninguno.
     */
    let conPrecio = 0;
    if (cols.length > 0) {
      const [c] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA} WHERE ${COLUMNA} IS NOT NULL`);
      conPrecio = c.n as number;
    }
    return {
      columna:
        cols.length === 0
          ? null
          : {
              tipo: cols[0].data_type as string,
              aceptaNull: cols[0].is_nullable === "YES",
              default: (cols[0].column_default as string | null) ?? null,
            },
      checks: cons.map((c) => `${c.conname}: ${c.def}`),
      conteos: { eventos: total.n as number, con_precio: conPrecio },
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está todo con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push("SIN BACKFILL: los eventos que ya existen quedan en NULL, o sea sin precio anunciado.");
      log.push("SIN DEFAULT: un default haría que cada evento viejo anuncie un precio que nadie escribió.");
      log.push("INFORMATIVO: no lo lee el carrito ni el checkout, y no se relaciona con unit_price_cop.");
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. con_precio no puede cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    await sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS ${COLUMNA} INTEGER`);

    /**
     * El swap del CHECK va en una transacción. Entre el DROP y el ADD hay una
     * ventana real de un round-trip —cada sql del driver HTTP de Neon es su
     * propio request— y si el ADD falla la ventana no se cierra nunca. El ADD va
     * desnudo: después del DROP no queda nada con ese nombre que duplicar, así
     * que un handler de duplicate_object solo podría tragarse un error real.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${CHECK}`),
      sql(`ALTER TABLE ${TABLA} ADD CONSTRAINT ${CHECK} ${DEF_CHECK}`),
    ]);

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: ${TABLA}.${COLUMNA} es integer, acepta NULL, sin default, y su CHECK tiene la definición exacta.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(`ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe ni borra filas.`);
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
