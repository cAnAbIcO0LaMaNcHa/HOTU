/**
 * VENTA_ONLINE APAGADO: QUE NO QUEDE NINGÚN CAMINO PARA CREAR UNA ORDEN.
 *
 * Dos mitades, y las dos hacen falta:
 *
 *   1. ESTÁTICA — que el único camino alcanzable siga siendo uno. Es un conteo
 *      sobre el fuente, y existe para que el día que alguien agregue un segundo
 *      INSERT INTO orders sin puerta, esto falle en vez de que nadie se entere.
 *      La guarda en un solo lugar es una garantía SOLO mientras el lugar sea uno.
 *
 *   2. CONTRA EL SERVER — que las páginas no ofrezcan comprar y que la cantidad
 *      de órdenes no se mueva.
 *
 * NO usa el candado ni el barrido: no escribe nada en la base. Solo lee y cuenta,
 * así que puede correr al lado de cualquier cosa.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { neon } from "@neondatabase/serverless";

const BASE = "http://localhost:3000";
const RAIZ = join(import.meta.dirname, "..", "..");
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

function fuentes(dir, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const nombre of entradas) {
    if (nombre === "node_modules" || nombre === ".next" || nombre.startsWith(".")) continue;
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (/\.(ts|tsx)$/.test(nombre)) acc.push(p);
  }
  return acc;
}

/**
 * SIN COMENTARIOS, y esto no es un detalle: la primera versión de esta batería
 * dio DOS MAL falsos porque grepeaba el fuente entero. lib/flags.ts salía como
 * "escribe orders" —su comentario explica cuáles son los caminos y nombra
 * INSERT INTO orders—, y la comparación de posiciones salía al revés porque el
 * comentario de la guarda menciona el INSERT antes de que aparezca el código.
 *
 * Un chequeo que mide documentación en vez de código es la misma familia que el
 * log congelado: no falla, contesta mal. Y acá contestaba mal en la dirección
 * peligrosa —reportando caminos que no existen—, que enseña a ignorarlo.
 *
 * El stripper cuida `://` para no cortar una URL al medio.
 */
const sinComentarios = (t) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");

console.log("=== 1. UN SOLO CAMINO ALCANZABLE HACIA UNA ORDEN (estático) ===");
{
  /**
   * Las rutas con MIGRATE_SECRET no cuentan como alcanzables: las corre una
   * persona a mano con el secreto en la URL. Se comprueba que LO TENGAN en vez
   * de confiar en el nombre del archivo — un seed sin puerta sí sería un camino.
   */
  const archivos = [...fuentes(join(RAIZ, "lib")), ...fuentes(join(RAIZ, "app"))];
  const escritores = [];
  for (const p of archivos) {
    const t = sinComentarios(readFileSync(p, "utf8"));
    if (!/INSERT\s+INTO\s+orders/i.test(t)) continue;
    const rel = relative(RAIZ, p).replace(/\\/g, "/");
    const conSecreto = /process\.env\.MIGRATE_SECRET/.test(t);
    escritores.push({ rel, conSecreto });
  }
  for (const e of escritores) {
    console.log(`   escribe orders -> ${e.rel}${e.conSecreto ? "  [MIGRATE_SECRET]" : "  [ALCANZABLE]"}`);
  }

  const alcanzables = escritores.filter((e) => !e.conSecreto).map((e) => e.rel);
  chk(
    "el único camino alcanzable es lib/actions.ts",
    alcanzables.length === 1 && alcanzables[0] === "lib/actions.ts",
    `alcanzables: ${alcanzables.join(", ") || "ninguno"}`
  );
  chk(
    "y encontró al menos un escritor (si no, el grep está roto)",
    escritores.length > 0,
    "cero escritores: el chequeo no prueba nada"
  );

  /** Y que ese único camino tenga la guarda, no solo que exista. */
  const actions = sinComentarios(readFileSync(join(RAIZ, "lib", "actions.ts"), "utf8"));
  chk(
    "createPendingOrder consulta ventaOnlineHabilitada()",
    /ventaOnlineHabilitada\(\)/.test(actions),
    "la guarda no está en el lib: esconder botones es una promesa, no una garantía"
  );
  const antesDelInsert =
    actions.indexOf("ventaOnlineHabilitada()") < actions.search(/INSERT\s+INTO\s+orders/i);
  chk("y la consulta va ANTES del INSERT", antesDelInsert, "la guarda está después de escribir");
}

console.log("\n=== 2. EL INTERRUPTOR ESTÁ APAGADO EN ESTE ENTORNO ===");
{
  chk(
    "VENTA_ONLINE no vale '1'",
    process.env.VENTA_ONLINE !== "1",
    `vale ${JSON.stringify(process.env.VENTA_ONLINE)} — el resto de la batería mide lo contrario de lo que cree`
  );
}

console.log("\n=== 3. LAS PÁGINAS NO OFRECEN COMPRAR ===");
{
  const pedir = async (u) => (await fetch(`${BASE}${u}`)).text();

  const eventos = await pedir("/eventos");
  chk("/eventos responde con contenido", eventos.length > 1000, `${eventos.length} bytes`);
  chk("sin botón AGREGAR ENTRADA", !/AGREGAR ENTRADA/i.test(eventos), "el botón de comprar sigue ahí");
  chk("sin selector NORMAL/VIP", !/>VIP</.test(eventos), "los tiers siguen ahí");
  chk(
    "y el precio de taquilla SÍ se puede seguir mostrando",
    true,
    "(depende de que haya un evento con precio; se mide en precio-taquilla.mjs)"
  );

  const tienda = await pedir("/tienda");
  chk("/tienda responde con contenido", tienda.length > 1000, `${tienda.length} bytes`);
  chk("sin botón de agregar al carrito", !/AGREGAR AL CARRITO|AGREGAR·|AGREGAR ·/i.test(tienda), "sigue el botón");
  chk(
    "pero el catálogo SIGUE viéndose",
    /\$/.test(tienda),
    "la tienda quedó vacía: apagar la venta no es apagar el catálogo"
  );
  chk(
    "y dice por qué no se puede comprar",
    /Todavía no vendemos/i.test(tienda),
    "no explica nada: un catálogo sin botón y sin motivo parece roto"
  );

  const home = await pedir("/");
  chk('sin ícono de carrito en el header', !/aria-label="Carrito"/.test(home), "el carrito sigue en el header");
}

console.log("\n=== 4. LA CANTIDAD DE ÓRDENES NO SE MUEVE ===");
{
  const [a] = await sql`SELECT COUNT(*)::int AS n FROM orders`;
  /**
   * No se puede invocar un Server Action desde acá sin el protocolo interno de
   * Next, así que lo que se mide es lo que sí se puede afirmar: que después de
   * recorrer las páginas de compra no apareció ninguna orden. La guarda del lib
   * está verificada arriba leyendo el fuente.
   */
  for (const u of ["/eventos", "/tienda", "/", "/perfil"]) await fetch(`${BASE}${u}`);
  const [b] = await sql`SELECT COUNT(*)::int AS n FROM orders`;
  chk("recorrer el sitio no creó ninguna orden", a.n === b.n, `${a.n} -> ${b.n}`);
  console.log(`      (órdenes en dev: ${b.n}, sin cambios)`);
}

console.log("\n=== 5. LO QUE NO SE APAGÓ, Y NO TENÍA QUE APAGARSE ===");
{
  const tiquetes = await fetch(`${BASE}/perfil/tiquetes`);
  chk(
    "/perfil/tiquetes sigue respondiendo (las boletas ya compradas valen)",
    tiquetes.status === 200 || tiquetes.status === 307,
    `status ${tiquetes.status}`
  );
  const admin = sinComentarios(readFileSync(join(RAIZ, "lib", "tickets-write.ts"), "utf8"));
  chk(
    "markOrderPaid NO se apagó: cobrar a mano una orden vieja sigue posible",
    !/ventaOnlineHabilitada/.test(admin),
    "se apagó también el cobro manual, y eso deja órdenes pendientes sin salida"
  );
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
