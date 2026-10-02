/**
 * CHEQUEO EN PRODUCCIÓN: los eventos pasados de main y el condicional de la hora.
 *
 *   node scripts/pruebas/prod-hora-pasados.mjs
 *
 * ============================================================
 * POR QUÉ ESTE CHEQUEO NO SE PODÍA HACER ANTES
 * ============================================================
 *
 * La verificación pedida era "un evento sin hora no muestra hora ni duración", y en
 * producción no se podía hacer: main tiene 3 eventos y los tres ya pasaron, y el bloque
 * de la hora vivía DENTRO de la rama de evento no pasado. O sea que el condicional
 * `e.startsAt && (...)` no se evaluaba nunca para ninguno de los tres. Decir "no muestra
 * hora" habría sido afirmar que un condicional funciona mirando una página que no lo
 * ejecuta — la misma forma que leer un 307 como "la página renderiza".
 *
 * Con la hora sacada de esa rama, los tres eventos pasados de main AHORA SÍ pasan por el
 * condicional, con starts_at en NULL. Recién ahora la ausencia significa algo: significa
 * que el condicional se evaluó y dio falso.
 *
 * ============================================================
 * NO BORRA NI ESCRIBE NADA, Y NO NECESITA SECRETO
 * ============================================================
 *
 * Pide páginas públicas y lee HTML. No toca la base, no necesita candado y no puede
 * pisar una batería: es la única de scripts/pruebas/ que corre contra PRODUCCIÓN, y por
 * eso es también la única que no abre corrida.
 *
 * ============================================================
 * SE COMPARA POR CONTENIDO, NUNCA POR CLASE DE TAILWIND
 * ============================================================
 *
 * Haciendo este chequeo a mano me equivoqué dos veces, las dos de la misma familia:
 *
 *   grep -c sobre la clase del div de la hora dio 1 y lo leí como "no está". grep -c
 *   cuenta LÍNEAS, y todo el HTML viene en pocas, así que una línea eran tres
 *   apariciones.
 *
 *   Después conté las tres y las reporté como si la hora SÍ se renderizara. Los tres
 *   divs decían FINALIZADO: comparte las clases de Tailwind EXACTAS con el div de la
 *   hora. Una clase de Tailwind no identifica un elemento, y en un proyecto con un
 *   sistema de clases consistente lo identifica menos todavía.
 *
 * Así que acá se busca CONTENIDO: un patrón de hora HH:MM, una duración "N h", y la
 * basura que podría aparecer en su lugar. Y la ventana de cada tarjeta se delimita con
 * el título entre > y < y se corta en el </article> siguiente, para que un título no
 * matchee a otro ni se lea la tarjeta de al lado.
 */

const BASE = process.env.PROD_BASE ?? "https://hotu-one.vercel.app";

let ok = 0;
let mal = 0;
const chk = (que, bien, detalle) => {
  if (bien) {
    ok += 1;
    console.log(`   OK   ${que}`);
  } else {
    mal += 1;
    console.log(`   MAL  ${que}${detalle ? ` -> ${detalle}` : ""}`);
  }
};

const html = await (await fetch(`${BASE}/eventos`)).text();
console.log(`${BASE}/eventos — ${html.length} bytes\n`);

/**
 * Los títulos NO están hardcodeados por gusto: son los eventos que main tiene hoy, y
 * verificar contra un fixture de dev —test-camila, otu, bodega-prueba— daría 404 para
 * siempre y se leería como "todavía no subió". Si main cambia de eventos, esta lista se
 * actualiza; que haya que tocarla es el precio de verificar contra algo que existe.
 *
 * Y SE COMPRUEBA QUE LOS TRES APAREZCAN ANTES DE MIRAR NADA MÁS. Si un título dejara de
 * estar, todos los chequeos de ausencia de abajo pasarían vacíos diciendo que todo está
 * bien, que es exactamente el modo de falla que este archivo existe para no repetir.
 */
const PASADOS = ["TADA · Miércoles de Techno", "CHÍA UNDERGROUND VOL.12", "HOTU RITUAL OPEN AIR"];

const tarjeta = (titulo) => {
  const i = html.indexOf(`>${titulo}<`);
  return i < 0 ? null : html.slice(i, html.indexOf("</article>", i));
};

console.log("=== 1. LOS TRES EVENTOS DE MAIN SE RENDERIZAN ===");
const tarjetas = new Map();
for (const t of PASADOS) {
  const c = tarjeta(t);
  tarjetas.set(t, c);
  chk(t, c !== null, "no aparece — si main cambió de eventos, actualizá la lista");
}

console.log("\n=== 2. SON PASADOS: EL CONDICIONAL DE LA HORA SE EVALÚA ===");
for (const [t, c] of tarjetas) {
  if (!c) continue;
  /**
   * FINALIZADO es la prueba de que la tarjeta tomó la rama de pasado. Importa porque es
   * lo que vuelve significativa la ausencia de hora: sin esto, "no muestra hora" podría
   * ser que la tarjeta no se renderizó en absoluto.
   */
  chk(`${t}: dice FINALIZADO`, /FINALIZADO/.test(c), c.slice(0, 200));
}

console.log("\n=== 3. SIN starts_at NO SE MUESTRA HORA NI DURACIÓN NI BASURA ===");
for (const [t, c] of tarjetas) {
  if (!c) continue;
  chk(`${t}: sin hora HH:MM`, !/\b([01]?\d|2[0-3]):[0-5]\d\b/.test(c), c.slice(0, 240));
  chk(`${t}: sin duración "N h"`, !/\b\d+ h\b/.test(c), c.slice(0, 240));
  chk(
    `${t}: sin Invalid Date / NaN / 1970`,
    !/Invalid Date|NaN|\b1970\b/.test(c),
    c.slice(0, 240)
  );
}

console.log("\n=== 4. LA RAMA DE VENTA NO CRUZÓ AL ARCHIVO ===");
for (const [t, c] of tarjetas) {
  if (!c) continue;
  chk(`${t}: sin precio en taquilla`, !/Taquilla|Entrada libre/.test(c), c.slice(0, 300));
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
