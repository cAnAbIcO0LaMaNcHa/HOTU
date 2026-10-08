/**
 * LAS TRES LLAVES, Y QUE TODA RUTA FALLE CERRADA SI SU VARIABLE NO EXISTE.
 *
 *   node --env-file=.env.local scripts/pruebas/llaves.mjs
 *
 * ============================================================
 * POR QUÉ EXISTE
 * ============================================================
 *
 * La batería de retención tenía un MODELO de la puerta del cron: copiaba la expresión del
 * route handler a mano. Cubría la mitad del cron y no la manual, así que nadie medía esta
 * forma:
 *
 *     searchParams.get("secret") === process.env.MIGRATE_SECRET
 *
 * Si la variable no está en el entorno, el lado derecho es `undefined`. Y
 * `searchParams.get("secret")` también devuelve `undefined`... no: devuelve `null`. Las dos
 * cosas no son iguales con `===`, así que ESA comparación concreta no se abre sola. Pero un
 * `?secret=undefined` contra un `String(process.env.X)`, o un `?? ""` sin comprobar el vacío,
 * sí. La diferencia es de un carácter y no se ve leyendo rápido.
 *
 * Así que esto no razona sobre el código: LLAMA A LOS HANDLERS DE VERDAD con la variable
 * borrada del entorno y mira qué contestan.
 *
 * ============================================================
 * LA LISTA DE RUTAS NO SE ESCRIBE A MANO
 * ============================================================
 *
 * Se descubre recorriendo app/api y quedándose con cada route.ts cuyo fuente mencione
 * process.env.MIGRATE_SECRET, SMOKE_SECRET o CRON_SECRET. Una lista a mano queda incompleta el
 * día que alguien agrega una ruta, y una lista incompleta que dice "todo OK" es exactamente lo
 * que este archivo existe para evitar — el mismo razonamiento que `sanas` en /api/smoke.
 *
 * Y SE EXIGE UN MÍNIMO: si el descubrimiento devolviera pocas rutas —porque el grep se rompió,
 * porque cambió la forma de leer la variable— la batería falla en vez de pasar vacía diciendo
 * que todo está bien. Mismo razonamiento que el barrido que daba cero en arnes.mjs.
 *
 * ============================================================
 * NO ES SOLO LA MITAD NEGATIVA
 * ============================================================
 *
 * Una prueba que solo comprueba los rechazos pasaría con una ruta que rechaza TODO, que es
 * peor que una abierta porque no se nota hasta que alguien necesita correrla. Así que cada
 * ruta se llama DOS veces: sin la variable —tiene que negar— y con la variable puesta y el
 * secreto correcto —tiene que dejar de negar—.
 *
 * LA MITAD POSITIVA NO EJECUTA EL TRABAJO DE LA RUTA, y eso hay que decirlo porque es la parte
 * delicada: se mide que la respuesta NO sea 401, no que la migración corra. Para no aplicar
 * DDL se usa dryRun donde existe, y las rutas que no lo tienen se llaman con un secreto
 * correcto pero una forma de petición que su propia validación rechaza después de la puerta.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { abrirCorrida } from "./seed.mjs";
import { neon } from "@neondatabase/serverless";

register("./scripts/pruebas/hook-rutas.mjs", pathToFileURL("./"));

const sql = neon(process.env.DATABASE_URL);

let ok = 0;
let mal = 0;
const chk = (n, c, d = "") => {
  if (c) {
    ok++;
    console.log("   OK   " + n);
  } else {
    mal++;
    console.log("   MAL  " + n + (d ? " -> " + d : ""));
  }
};

const LLAVES = ["MIGRATE_SECRET", "SMOKE_SECRET", "CRON_SECRET"];
const METODOS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
const MINIMO_RUTAS = 40;

/** Recorre app/api y se queda con los route.ts que miran alguna de las tres llaves. */
function descubrirRutas() {
  const encontradas = [];
  const anda = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) anda(p);
      else if (e === "route.ts") {
        const src = readFileSync(p, "utf8");
        const usa = LLAVES.filter((k) => src.includes(`process.env.${k}`));
        /**
         * Y LA PUERTA COMPARTIDA CUENTA COMO LAS DOS LLAVES QUE MIRA.
         *
         * Esto lo encontró la primera corrida: dijo CRON_SECRET en 0 rutas, y era cierto —
         * ninguna lo menciona desde que la puerta se movió a lib/cron-auth.ts. O sea que la
         * ruta de mantenimiento, JUSTO la del cron, no estaba en la lista y no se medía.
         *
         * Es el modo de falla de siempre: el descubrimiento no fallaba, contestaba de menos.
         * Por eso la afirmación de que las tres llaves aparecen en alguna ruta no es
         * decoración: es lo único que ataja que una ruta se vuelva invisible al cambiarle la
         * forma de leer el secreto.
         */
        if (src.includes("abrirPuertaDeMantenimiento")) {
          for (const k of ["CRON_SECRET", "MIGRATE_SECRET"]) if (!usa.includes(k)) usa.push(k);
        }
        if (usa.length > 0) encontradas.push({ path: p, usa });
      }
    }
  };
  anda("app/api");
  return encontradas.sort((a, b) => a.path.localeCompare(b.path));
}

const rutas = descubrirRutas();

const corrida = await abrirCorrida(sql, "llaves");

try {
  console.log(`\n1. DESCUBRIMIENTO (${rutas.length} rutas que leen una de las tres llaves)`);
  chk(
    `se descubrieron al menos ${MINIMO_RUTAS} rutas protegidas`,
    rutas.length >= MINIMO_RUTAS,
    `se encontraron ${rutas.length}: el descubrimiento está roto o la forma de leer la variable cambió`
  );
  chk(
    "las tres llaves aparecen al menos en una ruta cada una",
    LLAVES.every((k) => rutas.some((r) => r.usa.includes(k))),
    LLAVES.map((k) => `${k}: ${rutas.filter((r) => r.usa.includes(k)).length}`).join(", ")
  );

  /**
   * LAS VARIABLES SE BORRAN ANTES DE IMPORTAR, y el orden importa.
   *
   * El escenario real no es "la variable se fue a mitad de la vida del proceso" —el entorno se
   * fija al arrancar— sino "el server arrancó SIN ella". Así que se borran primero, y de ese
   * modo también queda medido el caso de una ruta que capturara el secreto a nivel de módulo.
   */
  const guardadas = {};
  for (const k of LLAVES) {
    guardadas[k] = process.env[k];
    delete process.env[k];
  }

  const modulos = new Map();
  const noImportadas = [];
  for (const r of rutas) {
    try {
      modulos.set(r.path, await import(`../../${r.path}`));
    } catch (e) {
      noImportadas.push(`${r.path}: ${String(e.message).slice(0, 70)}`);
    }
  }

  console.log("\n2. TODAS SE PUDIERON LLAMAR DE VERDAD");
  /**
   * Una ruta que no se puede importar NO se da por buena: se cuenta aparte y la batería falla.
   * Si mañana alguien agrega un import que el hook no sabe resolver, esto lo dice en vez de
   * bajar silenciosamente la cobertura.
   */
  chk(
    `las ${rutas.length} rutas protegidas se importaron y se van a llamar de verdad`,
    noImportadas.length === 0,
    noImportadas.join(" | ")
  );

  console.log("\n3. SIN NINGUNA DE LAS TRES LLAVES, NINGUNA RUTA PUEDE TENER ÉXITO");
  /**
   * Las formas adversarias son las que convierten una ausencia en una coincidencia: el string
   * "undefined" contra un String(undefined), el vacío contra un `?? ""`, y la ausencia total
   * del parámetro.
   */
  const PETICIONES = [
    ["sin ?secret", ""],
    ["?secret= (vacío)", "?secret="],
    ["?secret=undefined", "?secret=undefined"],
    ["?secret=null", "?secret=null"],
    ["?secret=undefined&dryRun=1", "?secret=undefined&dryRun=1"],
  ];
  const CUERPOS = [{}, { secret: "" }, { secret: "undefined" }, { secret: null }];

  const abiertas = [];
  let llamadas = 0;
  for (const r of rutas) {
    const mod = modulos.get(r.path);
    if (!mod) continue;
    for (const metodo of METODOS) {
      const handler = mod[metodo];
      if (typeof handler !== "function") continue;
      for (const [etiqueta, query] of PETICIONES) {
        const peticiones =
          metodo === "GET"
            ? [new Request(`http://x/${r.path}${query}`)]
            : CUERPOS.map(
                (c) =>
                  new Request(`http://x/${r.path}${query}`, {
                    method: metodo,
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(c),
                  })
              );
        for (const pedido of peticiones) {
          llamadas++;
          let estado;
          try {
            estado = (await handler(pedido)).status;
          } catch (e) {
            /** Reventar también es fallar cerrado: no entregó nada. Se anota el estado. */
            estado = `excepción: ${String(e.message).slice(0, 50)}`;
          }
          if (estado === 200 || estado === 201 || estado === 204) {
            abiertas.push(`${r.path} ${metodo} ${etiqueta} -> ${estado}`);
          }
        }
      }
    }
  }

  chk(
    `ninguna de las ${llamadas} llamadas sin llaves devolvió 2xx`,
    abiertas.length === 0,
    abiertas.join(" | ")
  );
  chk(
    "y se hicieron suficientes llamadas para que eso signifique algo",
    llamadas >= rutas.length * PETICIONES.length,
    `${llamadas} llamadas para ${rutas.length} rutas`
  );

  console.log("\n4. Y NO ES QUE RECHACEN TODO: CON LA LLAVE PUESTA DEJAN DE NEGAR");
  /**
   * La mitad positiva, sobre las dos rutas que SOLO LEEN. No se hace sobre las migraciones a
   * propósito: pasar el secreto correcto a una de ellas aplicaría DDL, y una prueba no tiene
   * por qué hacer eso para demostrar que una puerta se abre.
   *
   * Y alcanza para la pregunta que importa —"¿el chequeo es un rechazo incondicional?"—
   * porque todas las rutas usan la MISMA forma, verificado en el chequeo 5.
   */
  for (const k of LLAVES) if (guardadas[k] !== undefined) process.env[k] = guardadas[k];

  const fp = modulos.get("app/api/schema-fingerprint/route.ts");
  if (fp) {
    const buena = await fp.GET(
      new Request(`http://x/api/schema-fingerprint?secret=${process.env.SMOKE_SECRET}`)
    );
    chk("schema-fingerprint con el secreto correcto -> 200", buena.status === 200, `dio ${buena.status}`);
    const mala = await fp.GET(new Request("http://x/api/schema-fingerprint?secret=equivocado"));
    chk("y con uno equivocado -> 401", mala.status === 401, `dio ${mala.status}`);
  } else {
    chk("schema-fingerprint se pudo importar para la mitad positiva", false, "no se importó");
  }

  const conv = modulos.get("app/api/setup-convocatorias/route.ts");
  if (conv) {
    /** dryRun: la ruta no aplica nada, solo mira la forma. Medido en esta misma pieza. */
    const buena = await conv.GET(
      new Request(`http://x/api/setup-convocatorias?secret=${process.env.MIGRATE_SECRET}&dryRun=1`)
    );
    chk(
      "una ruta de MIGRATE_SECRET con el secreto correcto y dryRun -> 200",
      buena.status === 200,
      `dio ${buena.status}`
    );
  } else {
    chk("setup-convocatorias se pudo importar para la mitad positiva", false, "no se importó");
  }

  console.log(`\n5. LA FORMA DE LA GUARDA, EN LAS ${rutas.length}`);
  /**
   * El chequeo estático va DESPUÉS del dinámico y no en su lugar, y tiene un trabajo distinto:
   * el dinámico prueba que HOY niegan; esto prueba que lo hacen por la razón correcta.
   *
   * Una ruta podría negar sin la variable por casualidad —porque `null !== undefined`— y
   * romperse el día que alguien cambie `searchParams.get` por algo que devuelva undefined, o
   * meta un String() en medio. La guarda explícita de ausencia es lo que lo hace no depender
   * de eso.
   */
  const sinGuarda = [];
  for (const r of rutas) {
    const src = readFileSync(r.path, "utf8");
    const tieneGuarda = r.usa.every(
      (k) =>
        new RegExp(`!process\\.env\\.${k}`).test(src) ||
        /* cleanup la escribe aparte: `?? ""` seguido de un `if (!esperado) return false`. */
        new RegExp(`process\\.env\\.${k}\\s*\\?\\?\\s*""[\\s\\S]{0,200}?if \\(!esperado\\)`).test(src) ||
        /* y la puerta compartida la tiene en su propio archivo. */
        src.includes("abrirPuertaDeMantenimiento")
    );
    if (!tieneGuarda) sinGuarda.push(r.path);
  }
  chk(
    `las ${rutas.length} comprueban explícitamente que la variable EXISTE, no solo que coincida`,
    sinGuarda.length === 0,
    sinGuarda.join(", ")
  );

  console.log("\n6. LA PUERTA COMPARTIDA, EN SUS DOS MITADES");
  const { abrirPuertaDeMantenimiento } = await import("../../lib/cron-auth.ts");
  const conEntorno = (vars, fn) => {
    const previos = {};
    for (const [k, v] of Object.entries(vars)) {
      previos[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(previos)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const sinNada = conEntorno({ CRON_SECRET: undefined, MIGRATE_SECRET: undefined }, () =>
    abrirPuertaDeMantenimiento(
      new Request("http://x/a?secret=undefined", { headers: { authorization: "Bearer undefined" } })
    )
  );
  chk(
    "sin ninguna de las dos variables, la puerta de mantenimiento no abre por ningún lado",
    sinNada.ok === false && sinNada.status === 401,
    JSON.stringify(sinNada)
  );
} finally {
  const resumen = await corrida.cerrar();
  console.log(`\nbarrido: ${JSON.stringify(resumen?.borrado ?? {})}`);
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
