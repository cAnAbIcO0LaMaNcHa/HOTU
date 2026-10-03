/**
 * CHEQUEO EN PRODUCCIÓN: el EPK carga con galería y prensa VACÍAS, sin secciones rotas.
 *
 *   node scripts/pruebas/prod-epk-galeria-prensa.mjs
 *
 * En main las dos tablas existen y están en 0 filas, así que lo que hay que comprobar es
 * el caso que hoy viven todos los perfiles: que la página entera renderice y que las dos
 * secciones nuevas NO aparezcan para un visitante.
 *
 * ============================================================
 * UNA AUSENCIA SOLA NO PRUEBA NADA, ASÍ QUE VA CON CONTROL POSITIVO
 * ============================================================
 *
 * "No aparece GALERÍA" se cumple igual si la página no renderizó, si devolvió un 500, o si
 * el deploy todavía no subió. Las tres se ven idénticas a "la sección vacía se esconde
 * bien", que es lo que este chequeo quiere afirmar.
 *
 * Por eso cada perfil tiene que probar PRIMERO que renderizó de verdad: su nombre en el
 * HTML, el cierre de </html>, y alguna sección que SÍ tiene contenido. Recién entonces la
 * ausencia de las dos nuevas significa lo que parece.
 *
 * No toca la base y no necesita secreto: pide páginas públicas.
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

/**
 * Los slugs salen de /artistas en PRODUCCIÓN, no de una lista escrita a mano: un fixture de
 * dev daría 404 para siempre y el 404 se leería como "todavía no subió". Si la lista
 * cambia, esto sigue andando.
 */
const listado = await (await fetch(`${BASE}/artistas`)).text();
const slugs = [...new Set([...listado.matchAll(/href="\/artistas\/([a-z0-9-]+)"/g)].map((m) => m[1]))];

console.log(`${BASE}/artistas — ${slugs.length} perfiles encontrados\n`);

console.log("=== 0. HAY PERFILES CON LOS QUE PROBAR ===");
chk("el listado trajo al menos tres", slugs.length >= 3, `trajo ${slugs.length}`);
if (slugs.length === 0) {
  console.log("\nSin perfiles no hay nada que medir. Cortando antes de dar falsos OK.");
  process.exit(1);
}

const aProbar = slugs.slice(0, 3);

for (const slug of aProbar) {
  console.log(`\n=== ${slug} ===`);
  const res = await fetch(`${BASE}/artistas/${slug}`);
  const html = await res.text();

  /* El control positivo: la página de verdad se renderizó. */
  chk(`HTTP 200`, res.status === 200, String(res.status));
  chk(`el HTML cierra (</html>)`, html.includes("</html>"), "quedó cortado");
  chk(`tiene la cabecera del EPK`, /SOBRE MÍ|DJ SETS|EVENTOS|STATS/.test(html), "no hay ni una sección conocida");

  /* Y ahora sí, la ausencia significa algo. */
  chk(`GALERÍA no se muestra (0 fotos, visitante)`, !html.includes("GALERÍA"), "aparece vacía");
  chk(`PRENSA no se muestra (0 notas, visitante)`, !html.includes("PRENSA"), "aparece vacía");

  /* Y que no haya quedado nada a medias donde irían. */
  chk(
    `sin rastros de sección rota`,
    !/Invalid Date|NaN|undefined<|\[object Object\]/.test(html),
    "hay basura renderizada"
  );
}

console.log("\n=== LAS RUTAS NUEVAS EXISTEN Y ESTÁN CERRADAS ===");
for (const [ruta, metodo] of [
  [`/api/artists/${aProbar[0]}/photos`, "POST"],
  [`/api/artists/${aProbar[0]}/press`, "POST"],
]) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  /**
   * 401 y no 404: prueba que el código está desplegado SIN preguntarle nada a la base, y
   * que sin sesión no se escribe. Un 404 acá significaría que la ruta no subió.
   */
  chk(`${metodo} ${ruta} -> 401`, r.status === 401, String(r.status));
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
