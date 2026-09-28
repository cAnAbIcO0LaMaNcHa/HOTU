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
 * NULL, o cero o más. SIN TOPE.
 *
 * ============================================================
 * HUBO UN TECHO Y SE SACÓ. LA HISTORIA IMPORTA PORQUE MAIN LO TIENE.
 * ============================================================
 *
 * La primera versión ponía un techo de 10.000.000 con el argumento de que
 * atajaba un campo mal usado —una cédula, un teléfono— más que un precio. El
 * argumento anterior a ése era peor todavía y el reviewer lo tumbó: decía que
 * atajaba tipeos, y no puede, porque un cero de más sobre un precio normal da
 * 350.000, que es un precio posible. Ningún CHECK distingue un tipeo de una
 * decisión.
 *
 * Se saca entero por una razón más simple que cualquiera de las dos: EL PRECIO
 * ES DEL ORGANIZADOR. Un tope es la plataforma decidiendo cuánto puede costar
 * entrar a una fiesta ajena, y no tenemos por qué opinar. Un número absurdo se
 * ve en la página y lo corrige quien lo escribió; un tope que rechaza un precio
 * legítimo lo corrige nadie, porque el organizador no sabe que existe.
 *
 * OJO: MAIN TIENE EL CHECK CON TOPE. Esta migración ya corrió allá con la
 * versión vieja. El swap va con la próxima migración que toque events —la de
 * hora de inicio, punto 17— con DROP + ADD en una transacción, y está anotado en
 * PROGRESO.md porque el comparador de esquemas NO ve los CHECK: compara tablas y
 * columnas, así que esta diferencia es invisible para el post-deploy.
 *
 * Mientras tanto no hay nada roto: el CHECK de main es MÁS estricto que el de
 * acá, así que lo que pasa este validador pasa aquél, salvo un precio por encima
 * de diez millones. Es el único caso que main rechazaría y dev no.
 */
const DEF_CHECK = `CHECK (((${COLUMNA} IS NULL) OR (${COLUMNA} >= 0)))`;

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
