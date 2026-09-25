/**
 * EL COMPARADOR DE ESQUEMAS ATRAPA LA DERIVA QUE DEJÓ /admin EN 500.
 *
 * ============================================================
 * POR QUÉ NO ALCANZABA CORRERLO CONTRA LA BASE
 * ============================================================
 *
 * La rama que importa es "a main le falta una columna que dev tiene", y
 * eso NO se puede producir comparando dev contra dev: las dos mitades son
 * la misma base, así que el diff siempre sale vacío. Un TODO BIEN ahí no
 * dice nada sobre la rama que tiene que gritar.
 *
 * Así que se le pasan dos huellas ADULTERADAS a mano, con la deriva real
 * de main metida a propósito: sin artists.submitted_at, y una columna con
 * otro default.
 *
 * Importa compararEsquemas de scripts/post-deploy.mjs, o sea que prueba
 * EL CÓDIGO QUE CORRE, no una copia parecida. Una prueba que reimplementa
 * lo que verifica solo prueba que sabe reimplementarlo.
 *
 * No toca la base y no necesita ninguna credencial.
 */

import { compararEsquemas } from "../post-deploy.mjs";

let ok = 0, mal = 0;
const chk = (n, c, d = "") => {
  if (c) { ok++; console.log("   OK   " + n); }
  else { mal++; console.log("   MAL  " + n + (d ? " -> " + d : "")); }
};

/** Una huella mínima pero con la forma real de la ruta. */
const huella = (tablas) => ({ tablas });

const DEV = huella({
  artists: {
    slug: "text|notnull|-",
    submitted_at: "timestamp with time zone|null|-",
    status: "text|notnull|'draft'::text",
    review_status: "text|notnull|'borrador'::text",
  },
  news: { id: "integer|notnull|nextval('news_id_seq'::regclass)", submitted_at: "timestamp with time zone|null|-" },
  zz_test_lock: { id: "integer|notnull|-", quien: "text|notnull|-" },
});

console.log("=== LA DERIVA REAL DE MAIN: falta submitted_at y status tiene el default viejo ===");
{
  const MAIN = huella({
    artists: {
      slug: "text|notnull|-",
      // submitted_at NO está: es exactamente lo que pasó.
      status: "text|notnull|'published'::text", // y el default viejo
      review_status: "text|notnull|'borrador'::text",
    },
    news: { id: "integer|notnull|nextval('news_id_seq'::regclass)", submitted_at: "timestamp with time zone|null|-" },
    // zz_test_lock no existe en main, y está bien.
  });

  const d = compararEsquemas(DEV, MAIN);
  console.log("   (faltantes: " + JSON.stringify(d.faltantes) + ")");
  console.log("   (distintas: " + JSON.stringify(d.distintas.map((x) => x.columna)) + ")");

  chk("NOMBRA artists.submitted_at como faltante", d.faltantes.includes("artists.submitted_at"),
    JSON.stringify(d.faltantes));
  chk("y no inventa ninguna otra faltante", d.faltantes.length === 1, JSON.stringify(d.faltantes));

  chk("NOMBRA artists.status como forma distinta",
    d.distintas.some((x) => x.columna === "artists.status"), JSON.stringify(d.distintas));
  chk("con los dos valores, para poder decidir",
    d.distintas[0]?.dev === "text|notnull|'draft'::text" && d.distintas[0]?.main === "text|notnull|'published'::text",
    JSON.stringify(d.distintas[0]));
  chk("y no inventa ninguna otra distinta", d.distintas.length === 1, JSON.stringify(d.distintas));

  chk("DA PROBLEMA", d.hayProblema === true);

  chk("informa zz_test_lock como tabla solo-dev", d.soloDev.includes("zz_test_lock"), JSON.stringify(d.soloDev));
  chk("pero una tabla solo-dev NO alcanza para dar problema por sí sola",
    compararEsquemas(huella({ zz_test_lock: { id: "integer|notnull|-" } }), huella({})).hayProblema === false);
}

console.log("\n=== SIN DERIVA: main igual a dev más la tabla de pruebas ===");
{
  const MAIN = huella({
    artists: { ...DEV.tablas.artists },
    news: { ...DEV.tablas.news },
  });
  const d = compararEsquemas(DEV, MAIN);
  chk("no hay faltantes", d.faltantes.length === 0, JSON.stringify(d.faltantes));
  chk("no hay distintas", d.distintas.length === 0, JSON.stringify(d.distintas));
  chk("NO da problema", d.hayProblema === false);
  chk("y zz_test_lock sigue informándose", d.soloDev.includes("zz_test_lock"));
}

console.log("\n=== UNA COLUMNA DE MÁS EN MAIN NO ES UN PROBLEMA ===");
{
  // Main adelantada no rompe el código: el código no la usa todavía.
  const MAIN = huella({
    artists: { ...DEV.tablas.artists, columna_futura: "text|null|-" },
    news: { ...DEV.tablas.news },
  });
  const d = compararEsquemas(DEV, MAIN);
  chk("no la reporta como faltante ni distinta", !d.hayProblema, JSON.stringify(d));
}

console.log("\n=== UNA TABLA ENTERA QUE FALTE EN MAIN SE INFORMA, NO FALLA ===");
{
  // El smoke es el que grita si el código la usa. Acá solo se informa,
  // porque hay tablas legítimamente solo-dev y fallar por eso sería ruido
  // que nadie mira — y un chequeo que se ignora no chequea nada.
  const d = compararEsquemas(DEV, huella({ artists: { ...DEV.tablas.artists } }));
  chk("news aparece como solo-dev", d.soloDev.includes("news"), JSON.stringify(d.soloDev));
  chk("y no da problema por sí sola", d.hayProblema === false, JSON.stringify(d));
}

console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
process.exit(mal === 0 ? 0 : 1);
