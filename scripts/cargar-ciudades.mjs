/**
 * CARGA LAS CIUDADES DE GeoNames EN LA TABLA `cities`.
 *
 *   node scripts/cargar-ciudades.mjs --dry-run     cuenta qué haría, no escribe nada
 *   node scripts/cargar-ciudades.mjs               carga de verdad
 *   node scripts/cargar-ciudades.mjs --sin-espanol salta el archivo de 193 MB
 *
 * ============================================================
 * POR QUÉ UN SCRIPT Y NO UNA RUTA /api/setup-*
 * ============================================================
 *
 * Son ~130.000 filas. Una función de Vercel en plan Hobby corta muchísimo antes, así que la
 * forma habitual del repo —una ruta detrás de MIGRATE_SECRET— no puede hacer esto de una. La
 * alternativa era una ruta por tandas llamada ~26 veces, cada una bajando los 11 MB de nuevo.
 *
 * ============================================================
 * LA CADENA DE CONEXIÓN SE PIDE, NO SE PASA NI SE GUARDA
 * ============================================================
 *
 * No va en .env.local, porque que el DATABASE_URL de main NO exista en localhost es lo que
 * hace que "todo contra dev" sea una garantía y no una intención.
 *
 * Y TAMPOCO VA EN LA LÍNEA DE COMANDO: ahí queda en el historial de bash, en ~/.bash_history,
 * en texto plano y para siempre. Una credencial que se usa una vez no tiene por qué sobrevivir
 * a la sesión.
 *
 * Así que se pide por entrada OCULTA —sin eco— y vive en una variable que se borra al
 * terminar. Si la terminal no puede ocultar lo que se teclea, el script SE NIEGA en vez de
 * mostrar la cadena en pantalla: fallar ruidosamente es mejor que filtrarla en silencio.
 *
 * ============================================================
 * IDEMPOTENTE POR geonames_id
 * ============================================================
 *
 * ON CONFLICT (geonames_id) DO UPDATE. GeoNames publica cambios todos los días —poblaciones,
 * nombres, ciudades nuevas— así que una segunda corrida ACTUALIZA en vez de no hacer nada, y
 * reporta cuántas insertó y cuántas actualizó por separado. Esos dos números son la diferencia
 * entre "no hizo nada" y "no había nada que hacer".
 *
 * ============================================================
 * EL ARCHIVO DE NOMBRES EN ESPAÑOL PESA 193 MB Y NUNCA SE GUARDA ENTERO
 * ============================================================
 *
 * alternateNames.zip es el archivo grande de GeoNames. Se lee EN STREAMING, quedándose solo
 * con las filas cuyo isolanguage es 'es' Y cuyo geonameid está entre las ciudades que vamos a
 * cargar. Todo lo demás se descarta a medida que pasa: nunca entra entero ni a memoria ni a
 * Neon.
 *
 * El campo `alternatenames` que viene DENTRO de cities1000 no sirve para esto: es una lista
 * plana sin etiqueta de idioma, así que no se puede saber cuál de esos nombres es el español.
 *
 * GeoNames es CC BY 4.0: el crédito va en el pie del sitio.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const DRY_RUN = process.argv.includes("--dry-run");
const SIN_ESPANOL = process.argv.includes("--sin-espanol");

const BASE = "https://download.geonames.org/export/dump";
const CACHE = join(tmpdir(), "hotu-geonames");

/** Las columnas del formato geoname, verificadas contra el readme oficial. */
const COL = {
  geonameid: 0,
  name: 1,
  asciiname: 2,
  latitude: 4,
  longitude: 5,
  featureClass: 6,
  countryCode: 8,
  admin1: 10,
  population: 14,
};

/* ===================================================================
 * LA CADENA DE CONEXIÓN
 * =================================================================== */

/**
 * Pide la cadena sin mostrarla.
 *
 * SE NIEGA SI NO HAY TTY. En Git Bash sobre Windows, node a veces recibe un stdin que no es
 * una terminal —por winpty— y ahí setRawMode no existe. Sin raw mode no se puede apagar el
 * eco, así que la cadena aparecería en pantalla. Negarse y decir cómo arreglarlo es mejor que
 * mostrarla.
 */
async function pedirCadena() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error(
      "Esta terminal no deja ocultar lo que se teclea, así que la cadena de conexión se vería " +
        "en pantalla. En Git Bash sobre Windows, probá:\n" +
        "    winpty node scripts/cargar-ciudades.mjs" +
        (DRY_RUN ? " --dry-run" : "")
    );
  }

  process.stdout.write("Cadena de conexión (no se va a ver, no se guarda en ningún lado): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (ch) => {
      /* Enter: listo. Ctrl+C: salir. Backspace: borrar. Lo demás: acumular. */
      if (ch === "\r" || ch === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        buf.trim() ? resolve(buf.trim()) : reject(new Error("No escribiste nada."));
      } else if (ch === "\u0003") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        reject(new Error("Cancelado."));
      } else if (ch === "\u007f" || ch === "\b") {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

/**
 * Dice CONTRA QUÉ se va a escribir, sin revelar la cadena.
 *
 * Es lo único que separa "cargué main" de "cargué dev creyendo que era main". Se muestra el
 * host y la base, que alcanzan para reconocerla, y nunca la contraseña.
 */
function describirDestino(cadena) {
  try {
    const u = new URL(cadena);
    return `${u.hostname}${u.pathname}`;
  } catch {
    throw new Error("Eso no parece una cadena de conexión de Postgres.");
  }
}

/* ===================================================================
 * LOS ARCHIVOS DE GeoNames
 * =================================================================== */

/**
 * Baja un archivo si no está en caché. La caché vive en el temporal del sistema, no en el
 * repo: son 11 MB y 193 MB que no tienen por qué versionarse.
 */
async function bajar(nombre) {
  mkdirSync(CACHE, { recursive: true });
  const destino = join(CACHE, nombre);
  if (existsSync(destino) && statSync(destino).size > 0) {
    console.log(`  ${nombre}: ya estaba en caché (${(statSync(destino).size / 1e6).toFixed(1)} MB)`);
    return destino;
  }
  console.log(`  ${nombre}: bajando de ${BASE}...`);
  const res = await fetch(`${BASE}/${nombre}`);
  if (!res.ok) throw new Error(`${nombre}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destino));
  console.log(`  ${nombre}: ${(statSync(destino).size / 1e6).toFixed(1)} MB`);
  return destino;
}

/**
 * Lee un .zip de GeoNames línea por línea.
 *
 * Node no trae un lector de zip, y los de GeoNames tienen UN solo archivo adentro sin
 * compresión por entrada que node pueda abrir con zlib directamente. Así que se usa el .txt
 * suelto que GeoNames también publica para los archivos chicos, y para cities1000 se descomprime
 * con el unzip del sistema, que existe en Git Bash.
 */
async function* lineasDeZip(rutaZip, nombreInterno) {
  const { spawn } = await import("node:child_process");
  const p = spawn("unzip", ["-p", rutaZip, nombreInterno], { stdio: ["ignore", "pipe", "pipe"] });
  let errores = "";
  p.stderr.on("data", (d) => (errores += d));
  const rl = createInterface({ input: p.stdout, crlfDelay: Infinity });
  for await (const linea of rl) yield linea;
  const code = await new Promise((r) => p.on("close", r));
  if (code !== 0) {
    throw new Error(
      `unzip falló sobre ${rutaZip} (código ${code}). ${errores.slice(0, 200)}\n` +
        "Git Bash trae unzip; si no está, instalalo o descomprimí el archivo a mano."
    );
  }
}

/* ===================================================================
 * LA CORRIDA
 * =================================================================== */

async function main() {
  console.log(
    DRY_RUN
      ? "\n=== SIMULACIÓN: se va a contar todo y NO se va a escribir una sola fila ===\n"
      : "\n=== CARGA REAL ===\n"
  );

  /** El alpha-2 -> alpha-3 sale de lib/paises.ts: una sola fuente para esa relación. */
  const { register } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  register("./scripts/pruebas/hook-rutas.mjs", pathToFileURL("./"));
  const texto = readFileSync("lib/paises.ts", "utf8");
  const pares = texto.match(/"([A-Z]{2}:[A-Z]{3}[^"]*)"/g) ?? [];
  const A2A3 = new Map();
  for (const trozo of pares) {
    for (const par of trozo.replace(/"/g, "").trim().split(/\s+/)) {
      const [a2, a3] = par.split(":");
      if (a2 && a3) A2A3.set(a2, a3);
    }
  }
  if (A2A3.size < 200) {
    throw new Error(
      `Solo saqué ${A2A3.size} pares alpha-2:alpha-3 de lib/paises.ts y tienen que ser 249. ` +
        "Si cambió el formato de PARES, este parseo quedó corto y las ciudades entrarían con el " +
        "país equivocado."
    );
  }
  console.log(`Pares de país leídos de lib/paises.ts: ${A2A3.size}`);

  console.log("\nArchivos de GeoNames:");
  const zipCiudades = await bajar("cities1000.zip");

  /* 1. Las ciudades. */
  const ciudades = [];
  const sinPais = new Set();
  for await (const linea of lineasDeZip(zipCiudades, "cities1000.txt")) {
    if (!linea) continue;
    const c = linea.split("\t");
    const a3 = A2A3.get(c[COL.countryCode]);
    if (!a3) {
      sinPais.add(c[COL.countryCode]);
      continue;
    }
    ciudades.push({
      id: Number(c[COL.geonameid]),
      nombre: c[COL.name],
      pais: a3,
      admin1: c[COL.admin1] || null,
      poblacion: Number(c[COL.population]) || 0,
      lat: Number(c[COL.latitude]),
      lng: Number(c[COL.longitude]),
    });
  }
  console.log(`\nCiudades leídas: ${ciudades.length}`);
  if (sinPais.size > 0) {
    console.log(
      `  SALTEADAS por país desconocido: ${[...sinPais].join(", ")} — son códigos que GeoNames ` +
        "usa y que ISO 3166-1 no asigna."
    );
  }

  /* 2. Los nombres en español, en streaming. */
  const enEspanol = new Map();
  if (!SIN_ESPANOL) {
    const idsQueImportan = new Set(ciudades.map((c) => c.id));
    const zipAlt = await bajar("alternateNames.zip");
    let leidas = 0;
    for await (const linea of lineasDeZip(zipAlt, "alternateNames.txt")) {
      leidas++;
      const a = linea.split("\t");
      if (a[2] !== "es") continue;
      const id = Number(a[1]);
      if (!idsQueImportan.has(id)) continue;
      /** isPreferredName gana; si no hay preferido, el primero que aparezca. */
      if (a[4] === "1" || !enEspanol.has(id)) enEspanol.set(id, a[3]);
    }
    console.log(
      `\nNombres en español: ${enEspanol.size} de ${ciudades.length} ciudades ` +
        `(se leyeron ${leidas.toLocaleString("es")} filas y se descartó todo lo demás).`
    );
  } else {
    console.log("\n--sin-espanol: no se bajó alternateNames. nombre_es va a quedar en NULL.");
  }

  if (DRY_RUN) {
    const conEs = ciudades.filter((c) => enEspanol.has(c.id)).length;
    const porPais = new Map();
    for (const c of ciudades) porPais.set(c.pais, (porPais.get(c.pais) ?? 0) + 1);
    const top = [...porPais.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log("\n=== LO QUE HARÍA ===");
    console.log(`  insertar o actualizar: ${ciudades.length} ciudades`);
    console.log(`  con nombre en español: ${conEs}`);
    console.log(`  países representados:  ${porPais.size}`);
    console.log(`  los cinco con más:     ${top.map(([p, n]) => `${p}=${n}`).join(", ")}`);
    console.log(`  Colombia:              ${porPais.get("COL") ?? 0}`);
    console.log("\nNo se escribió nada y no se pidió ninguna cadena de conexión.");
    return;
  }

  /* 3. Recién acá se pide la conexión: después de que todo lo demás funcionó. */
  /**
   * HOTU_CADENA_DIRECTA existe SOLO para cargar dev desde otro script, donde la cadena ya
   * está en .env.local y pedirla por teclado no protegería nada. Para main NO se usa: ahí
   * la variable no está y el script pide la cadena con entrada oculta, que es el camino que
   * evita que la credencial de producción quede en un archivo o en el historial de bash.
   */
  const cadena = process.env.HOTU_CADENA_DIRECTA || (await pedirCadena());
  const destino = describirDestino(cadena);
  console.log(`\nDestino: ${destino}`);

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(cadena);

  /**
   * QUE LA TABLA EXISTA, ANTES DE CUALQUIER OTRA COSA.
   *
   * Sin esto el primer SELECT revienta con el error crudo de Postgres —
   * relation "cities" does not exist— que no dice qué hacer. Y pasa en el caso MÁS probable:
   * alguien corre el script contra main antes de correr la migración ahí.
   *
   * Peor todavía: para entonces ya tecleó la cadena de conexión de producción. Fallar con un
   * mensaje que nombra la migración convierte un susto en un paso que falta.
   */
  const [hayTabla] = await sql`
    SELECT 1 AS si FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cities'`;
  if (!hayTabla) {
    throw new Error(
      [
        `No existe la tabla cities en ${destino}. Corré primero la migración:`,
        "    /api/setup-cities?secret=MIGRATE_SECRET&dryRun=1   para ver qué falta",
        "    /api/setup-cities?secret=MIGRATE_SECRET            para crearla",
        "No se escribió nada.",
      ].join("\n")
    );
  }

  /**
   * Y QUE TENGA LA FORMA QUE ESTE SCRIPT ESPERA. Una tabla cities de otra versión —sin
   * nombre_es, por ejemplo— dejaría pasar el chequeo de arriba y fallaría recién en el primer
   * INSERT, a mitad de la carga.
   */
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cities'`;
  const tiene = new Set(cols.map((c) => c.column_name));
  const faltan = [
    "geonames_id", "nombre", "nombre_es", "country_code", "admin1", "poblacion", "lat", "lng",
  ].filter((c) => !tiene.has(c));
  if (faltan.length > 0) {
    throw new Error(
      `La tabla cities de ${destino} no tiene las columnas que este script escribe: ` +
        `faltan ${faltan.join(", ")}. Corré /api/setup-cities ahí. No se escribió nada.`
    );
  }

  const [antes] = await sql`SELECT COUNT(*)::int AS n FROM cities`;
  console.log(`cities tenía ${antes.n} fila(s).`);

  const TANDA = 1000;
  let insertadas = 0;
  for (let i = 0; i < ciudades.length; i += TANDA) {
    const tanda = ciudades.slice(i, i + TANDA);
    await sql(
      `INSERT INTO cities (geonames_id, nombre, nombre_es, country_code, admin1, poblacion, lat, lng)
       SELECT * FROM unnest(
         $1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::numeric[], $8::numeric[]
       )
       ON CONFLICT (geonames_id) DO UPDATE SET
         nombre = EXCLUDED.nombre, nombre_es = EXCLUDED.nombre_es,
         country_code = EXCLUDED.country_code, admin1 = EXCLUDED.admin1,
         poblacion = EXCLUDED.poblacion, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
      [
        tanda.map((c) => c.id),
        tanda.map((c) => c.nombre),
        tanda.map((c) => enEspanol.get(c.id) ?? null),
        tanda.map((c) => c.pais),
        tanda.map((c) => c.admin1),
        tanda.map((c) => c.poblacion),
        tanda.map((c) => c.lat),
        tanda.map((c) => c.lng),
      ]
    );
    insertadas += tanda.length;
    if (insertadas % 10000 === 0 || insertadas === ciudades.length) {
      console.log(`  ${insertadas} / ${ciudades.length}`);
    }
  }

  const [despues] = await sql`SELECT COUNT(*)::int AS n FROM cities`;
  const [conEs] = await sql`SELECT COUNT(*)::int AS n FROM cities WHERE nombre_es IS NOT NULL`;
  console.log(
    `\ncities: ${antes.n} -> ${despues.n} fila(s). Nuevas: ${despues.n - antes.n}, ` +
      `actualizadas: ${ciudades.length - (despues.n - antes.n)}. Con nombre en español: ${conEs.n}.`
  );
}

main()
  .then(() => console.log("\nListo.\n"))
  .catch((e) => {
    console.error(`\nERROR: ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    /** La caché de descargas NO se borra: son 204 MB y volver a bajarlos no aporta nada. */
    if (process.env.HOTU_BORRAR_CACHE === "1") await rm(CACHE, { recursive: true, force: true });
  });
