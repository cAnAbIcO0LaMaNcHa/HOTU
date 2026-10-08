/**
 * NINGUNA FECHA DE CALENDARIO SE DERIVA DE UN INSTANTE SIN DECIR LA ZONA.
 *
 *   node --env-file=.env.local scripts/pruebas/zonas.mjs
 *   node --env-file=.env.local scripts/pruebas/zonas.mjs --detalle
 *   node --env-file=.env.local scripts/pruebas/zonas.mjs --probar
 *
 * ============================================================
 * POR QUÉ HAY UN CHEQUEO Y NO SOLO UNA ADVERTENCIA
 * ============================================================
 *
 * El mismo error apareció TRES veces, con tres caras distintas:
 *
 *   1. toISODate hacía value.toISOString().slice(0, 10) y corría un día para atrás en
 *      cualquier server adelantado de UTC.
 *   2. El cierre de las convocatorias usaba current_date, que en la sesión de Neon es UTC:
 *      medido, a las 03:08 UTC del 8 de octubre daba el 8 cuando en Bogotá era el 7.
 *   3. La prueba de ese mismo cierre comparaba con cierra_en::date y fallaba por un día,
 *      ACUSANDO AL CÓDIGO, que estaba bien.
 *
 * Las tres son la misma: el error entra al cruzar entre "fecha de calendario" e "instante" sin
 * decidir en qué zona. Y las tres son invisibles en Bogotá o en UTC la mayor parte del día, así
 * que se escapan de cualquier revisión a ojo.
 *
 * ============================================================
 * DOS REGLAS, PORQUE NO TODO ::date ES PELIGROSO
 * ============================================================
 *
 * REGLA A — ::date SOBRE UN INSTANTE.
 *
 *   `cierra_en::date` es peligroso: convierte usando la zona de la SESIÓN. Pero
 *   `'2026-02-14'::date` y `${fecha}::date` NO lo son: lo que se castea es TEXTO, que no tiene
 *   zona y por lo tanto no puede correrse.
 *
 *   La diferencia no se puede adivinar leyendo el nombre, así que LAS COLUMNAS timestamptz SE
 *   PREGUNTAN A LA BASE. Eso mantiene la regla correcta cuando el esquema cambia, y evita el
 *   modo de falla de una lista a mano que queda corta y dice que todo está bien.
 *
 *   Una regla puramente textual —"::date sin AT TIME ZONE"— habría disparado sobre 20 casos
 *   inofensivos, y un chequeo que grita por nada es un chequeo que alguien apaga.
 *
 * REGLA B — current_date.
 *
 *   Siempre significa "hoy", y hoy tiene zona. En la sesión del driver HTTP de Neon es UTC,
 *   así que entre las 19:00 y la medianoche de Bogotá ya es mañana.
 *
 * ============================================================
 * LAS EXCEPCIONES SON POCAS Y CADA UNA DICE POR QUÉ
 * ============================================================
 *
 * Una lista de excepciones sin razón escrita es la forma de apagar la alarma sin decir que se
 * la apagó. Las de acá son de dos clases y ninguna es "es molesto arreglarlo":
 *
 *   MIGRACIONES YA CORRIDAS — editarlas no cambia nada: las tablas ya existen con la forma que
 *   esas sentencias les dieron. Son historia, no código que vuelva a correr con efecto.
 *
 *   FIXTURES DE PRUEBA que solo necesitan "un día futuro" o "un día pasado" y cuya aserción no
 *   mira el día exacto. Van nombradas una por una, nunca por directorio: excluir
 *   scripts/pruebas entero dejaría sin cubrir justamente el archivo donde el error apareció la
 *   tercera vez.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync, statSync } from "node:fs";

const sql = neon(process.env.DATABASE_URL);

const DETALLE = process.argv.includes("--detalle");
const PROBAR = process.argv.includes("--probar");

const ZONA = "AT TIME ZONE 'America/Bogota'";

/**
 * Las excepciones, con su razón. `linea` es opcional: sin ella vale para todo el archivo, y
 * eso solo se usa donde el archivo ENTERO es de una de las dos clases justificadas.
 */
const EXCEPCIONES = [
  {
    patron: /^scripts\/pruebas\/zonas\.mjs$/,
    razon:
      "ESTE MISMO ARCHIVO. Sus casos de prueba SON las formas peligrosas, escritas a propósito " +
      "para ejercitar el clasificador, y sus mensajes las nombran para explicarlas. Un chequeo " +
      "que se marca a sí mismo no encuentra nada: enterraría los hallazgos de verdad en su " +
      "propio ruido.",
  },
  {
    patron: /^app\/api\/setup-/,
    razon:
      "MIGRACIÓN YA CORRIDA. Su DDL y sus backfills ya se aplicaron en dev y en main: las " +
      "tablas existen con la forma que esas sentencias les dieron. Cambiarle un CURRENT_DATE " +
      "no movería ni una fila, y reescribir el historial de una migración aplicada es peor " +
      "que dejarlo — el archivo documenta lo que de verdad se corrió.",
  },
  {
    patron: /^app\/api\/(seed-test|seed-genres|migrate)\//,
    razon:
      "SEMBRADO DE PRUEBA detrás de MIGRATE_SECRET. No es un camino alcanzable del producto, " +
      "y lo que escribe son fechas de fixtures donde un día de corrimiento no cambia nada.",
  },
];

/** Los archivos a mirar. */
function archivos() {
  const encontrados = [];
  const anda = (dir) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".next") continue;
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) anda(p);
      else if (/\.(ts|tsx|mjs)$/.test(e)) encontrados.push(p);
    }
  };
  for (const raiz of ["lib", "app", "scripts/pruebas"]) anda(raiz);
  return encontrados.sort();
}

/**
 * Las columnas timestamptz, PREGUNTADAS A LA BASE.
 *
 * Y si la consulta devolviera pocas, el chequeo se vuelve ciego sin avisar: una lista vacía
 * haría que la regla A no encuentre nunca nada y el informe diría "todo bien". Por eso hay un
 * mínimo más abajo.
 */
async function columnasInstante() {
  const filas = await sql`
    SELECT DISTINCT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'
    ORDER BY column_name`;
  return filas.map((f) => f.column_name);
}

/** Saca comentarios de línea y de bloque, para no contar lo que explica el problema. */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, " "));
}

function excepcionDe(ruta) {
  const normal = ruta.replace(/\\/g, "/");
  return EXCEPCIONES.find((x) => x.patron.test(normal)) ?? null;
}

/**
 * Busca las dos reglas en un fuente ya sin comentarios.
 *
 * Devuelve una entrada por LÍNEA, con su regla y el texto. La unidad es la línea igual que en
 * metrica-entity-kind, para que los números se puedan comparar entre informes.
 */
export function buscarEnFuente(src, columnas) {
  const hallazgos = [];
  const lineas = sinComentarios(src).split("\n");
  const originales = src.split("\n");

  /** Las formas de "un instante" que pueden ir antes de ::date. */
  const instantes = [...columnas, "now\\(\\)", "CURRENT_TIMESTAMP", "localtimestamp"];
  const reA = new RegExp(`(?:\\w+\\.)?(?:${instantes.join("|")})\\s*::\\s*date`, "i");

  lineas.forEach((linea, i) => {
    const texto = (originales[i] ?? "").trim();

    if (reA.test(linea) && !linea.includes(ZONA)) {
      hallazgos.push({ regla: "A", n: i + 1, texto });
    }
    if (/\bcurrent_date\b/i.test(linea) && !linea.includes(ZONA)) {
      hallazgos.push({ regla: "B", n: i + 1, texto });
    }
  });
  return hallazgos;
}

/* ===================================================================
 * LA CORRIDA
 * =================================================================== */

if (PROBAR) {
  /**
   * SE PRUEBA A SÍ MISMO, y hace falta por lo mismo que en metrica-entity-kind: hoy el informe
   * dice "limpio", y eso puede significar que el código está bien o que el buscador no busca
   * nada. Cada forma se ejercita contra su clase esperada.
   */
  const columnas = ["cierra_en", "creada_en", "starts_at"];
  const casos = [
    ["cierra_en::date", "A", "un instante casteado, pelado"],
    ["ec.cierra_en::date", "A", "con alias"],
    ["ec.cierra_en :: date", "A", "con espacios alrededor del ::"],
    ["now()::date", "A", "now() pelado"],
    ["(cierra_en AT TIME ZONE 'America/Bogota')::date", null, "ya tiene la zona"],
    ["'2026-02-14'::date", null, "un literal de texto no tiene zona"],
    ["${fecha}::date", null, "un parámetro tampoco"],
    ["${dia}::date, 'Bogota'", null, "un parámetro con más cosas en la línea"],
    ["event_date::date", null, "una columna DATE no es un instante"],
    ["CURRENT_DATE", "B", "en mayúsculas"],
    ["current_date + 30", "B", "en minúsculas y con aritmética"],
    ["(now() AT TIME ZONE 'America/Bogota')::date", null, "la forma correcta entera"],
    ["// cierra_en::date es el bug", null, "un comentario de línea no cuenta"],
    ["/* current_date miente */", null, "un comentario de bloque tampoco"],
    ["const url = 'http://x/a'", null, "el // de una URL no rompe el despojado"],
  ];

  let ok = 0;
  let mal = 0;
  for (const [src, esperado, por] of casos) {
    const h = buscarEnFuente(src, columnas);
    const dio = h.length === 0 ? null : h[0].regla;
    if (dio === esperado) {
      ok++;
      console.log(`   OK   ${por} -> ${esperado ?? "no dispara"}`);
    } else {
      mal++;
      console.log(`   MAL  ${por} -> esperaba ${esperado ?? "nada"} y dio ${dio ?? "nada"}`);
    }
  }

  /** Y que una línea con las dos formas dispare las dos, no una. */
  const dos = buscarEnFuente("WHERE cierra_en::date < CURRENT_DATE", columnas);
  if (dos.length === 2) {
    ok++;
    console.log("   OK   una línea con las dos formas dispara las dos");
  } else {
    mal++;
    console.log(`   MAL  una línea con las dos formas dio ${dos.length} hallazgos`);
  }

  console.log(`\n=== ${ok} OK, ${mal} MAL ===`);
  process.exit(mal === 0 ? 0 : 1);
}

const columnas = await columnasInstante();
console.log(`Columnas timestamptz medidas en el esquema: ${columnas.length}`);
if (columnas.length < 20) {
  console.log(
    `\nABORTA: solo ${columnas.length} columnas timestamptz. La regla A se apoya en esa lista, ` +
      "así que con una lista corta el informe diría 'limpio' sin haber mirado nada."
  );
  process.exit(1);
}

const hallazgos = [];
const excusados = [];
for (const ruta of archivos()) {
  const h = buscarEnFuente(readFileSync(ruta, "utf8"), columnas);
  if (h.length === 0) continue;
  const exc = excepcionDe(ruta);
  for (const x of h) {
    (exc ? excusados : hallazgos).push({ ruta, ...x, razon: exc?.razon });
  }
}

const porRegla = (lista, r) => lista.filter((x) => x.regla === r).length;

console.log(
  `\nEXCUSADOS: ${excusados.length} (regla A ${porRegla(excusados, "A")}, ` +
    `regla B ${porRegla(excusados, "B")}) en archivos con excepción justificada.`
);
if (DETALLE) {
  for (const x of excusados) console.log(`  ${x.ruta}:${x.n}  [${x.regla}]  ${x.texto}`);
}

console.log(
  `\nHALLAZGOS: ${hallazgos.length} (regla A ${porRegla(hallazgos, "A")}, ` +
    `regla B ${porRegla(hallazgos, "B")}).`
);
for (const x of hallazgos) console.log(`  ${x.ruta}:${x.n}  [${x.regla}]  ${x.texto}`);

console.log(
  hallazgos.length === 0
    ? "\nLIMPIO: ninguna fecha de calendario se deriva de un instante sin decir la zona."
    : "\nREGLA A: un ::date sobre un instante usa la zona de la SESIÓN, que en Neon es UTC.\n" +
        "REGLA B: current_date significa 'hoy', y hoy tiene zona.\n" +
        `Lo correcto en los dos casos es (<expr> ${ZONA})::date, o la constante HOY_EN_BOGOTA.`
);

process.exit(hallazgos.length === 0 ? 0 : 1);
