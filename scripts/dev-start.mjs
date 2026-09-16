/**
 * EL ÚNICO CAMINO PARA LEVANTAR EL DEV SERVER.
 *
 * Existe por una falla que ya invalidó verificaciones dos veces, con la
 * misma forma y dos causas distintas: el log que alguien estaba leyendo
 * como prueba de "cero errores de hidratación" no era del server que
 * estaba contestando. La segunda vez el comando que tenía que crear el
 * archivo murió con exit 127 en segundo plano, nadie miró el código de
 * salida, y el server terminó levantado por otra vía sin escribir a
 * ningún lado. El archivo tenía 0 bytes y se leyó igual.
 *
 * Anotarlo como regla no alcanzó. Así que:
 *
 *   1. EL LOG SE CREA ANTES DE ARRANCAR, y si no se puede crear esto
 *      aborta con un mensaje y código distinto de cero. No hay camino en
 *      el que el server quede vivo y el log no exista.
 *   2. SIEMPRE EL MISMO ARCHIVO: dev.log, en la raíz. Nada de dev3,
 *      dev4, dev5 — la numeración fue justamente lo que dejó archivos
 *      viejos dando vueltas para que alguien leyera el equivocado.
 *   3. SE TRUNCA EN CADA ARRANQUE y la primera línea lleva fecha y PID,
 *      así se ve de un vistazo a qué corrida pertenece lo que estás
 *      leyendo.
 *   4. SI EL LOG NO CRECE, ESTO FALLA. Después de arrancar se espera a
 *      que el server diga que está listo y se confirma que el archivo
 *      tiene bytes. Si en DEV_READY_TIMEOUT_MS no pasó, aborta.
 *
 * Sigue saliendo todo por consola además de al archivo, así que usarlo a
 * mano se siente igual que antes.
 *
 * Para saltear el chequeo de puerto a propósito: DEV_SKIP_CHECK=1. Sigue
 * pasando por acá, así que sigue habiendo log.
 */

import { spawn } from "node:child_process";
import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(raiz, "dev.log");
const TIMEOUT = Number(process.env.DEV_READY_TIMEOUT_MS ?? 120000);

function morir(titulo, detalle) {
  console.error("");
  console.error(`  ${titulo}`);
  console.error("");
  for (const linea of detalle) console.error(`  ${linea}`);
  console.error("");
  process.exit(1);
}

// --- 1. que no haya otro server ---------------------------------------
// VA PRIMERO, antes de tocar el log. Abrir el log trunca, así que un
// arranque rechazado le borraría el log al server que SÍ está sirviendo
// y lo estamparía con el PID del proceso rechazado. Eso deja el archivo
// diciendo que pertenece a un proceso que no está contestando, que es
// literalmente el estado que este script existe para que no exista.
if (process.env.DEV_SKIP_CHECK !== "1") {
  const check = spawn(process.execPath, [join(raiz, "scripts", "dev-check.mjs")], {
    stdio: "inherit",
  });
  const codigo = await new Promise((r) => check.once("exit", r));
  if (codigo !== 0) process.exit(codigo ?? 1);
}

// --- 2. el log, antes de arrancar next --------------------------------
// Si esto no se puede, no se arranca. Un server sin log es un server
// cuyas verificaciones no valen, y es mejor no tenerlo que tenerlo y
// creerle a un archivo viejo.
let fd;
try {
  fd = openSync(LOG, "w");
  writeSync(fd, `=== dev server arrancado ${new Date().toISOString()} — pid ${process.pid}\n`);
} catch (e) {
  morir(`No se pudo crear ${LOG}: ${e.message}`, [
    "El server NO se levantó, a propósito.",
    "",
    "Sin log no hay forma de verificar nada después, y ya pasó dos veces",
    "que alguien leyera como evidencia un archivo que ningún server estaba",
    "escribiendo. Arreglá el permiso o el disco y volvé a intentar.",
  ]);
}

// --- 3. arrancar next -------------------------------------------------
// Se invoca el bin de next con este mismo node en vez de "next" a secas:
// resolver el comando por PATH es exactamente lo que falló con exit 127,
// y en Windows además mete el .cmd y el shell en el medio.
const require = createRequire(import.meta.url);
let binNext;
try {
  binNext = require.resolve("next/dist/bin/next");
} catch {
  closeSync(fd);
  morir("No encontré el binario de next.", ["¿Corriste npm install?"]);
}

const hijo = spawn(process.execPath, [binNext, "dev", ...process.argv.slice(2)], {
  cwd: raiz,
  stdio: ["inherit", "pipe", "pipe"],
});

let listo = false;
/** Todo lo que sale del server va al archivo Y a la consola. */
function tee(stream, salida) {
  stream.on("data", (chunk) => {
    try {
      writeSync(fd, chunk);
    } catch {
      // Un log que dejó de escribirse a mitad es el caso que esto
      // previene, así que se grita y se corta.
      console.error("\n  El log dejó de poder escribirse. Bajando el server.\n");
      hijo.kill();
    }
    salida.write(chunk);
    if (/Ready in|- Local:/.test(String(chunk))) listo = true;
  });
}
tee(hijo.stdout, process.stdout);
tee(hijo.stderr, process.stderr);

// Ctrl+C tiene que bajar el server, no dejarlo huérfano: un next dev
// suelto sobre el mismo .next es el otro problema que ya costó tiempo
// tres veces.
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => hijo.kill(senal));
}

let salioSolo = null;
hijo.once("exit", (codigo) => {
  salioSolo = codigo ?? 0;
});

// --- 4. confirmar que el log de verdad tiene algo ---------------------
const limite = Date.now() + TIMEOUT;
while (!listo && salioSolo === null && Date.now() < limite) {
  await new Promise((r) => setTimeout(r, 250));
}

if (salioSolo !== null) {
  closeSync(fd);
  morir(`next dev salió solo con código ${salioSolo}.`, [`El detalle está en ${LOG}.`]);
}

if (!listo) {
  hijo.kill();
  closeSync(fd);
  morir(`El server no estuvo listo en ${TIMEOUT} ms.`, [
    `Mirá ${LOG}. Si está vacío, el problema es el log, no el server.`,
  ]);
}

const bytes = statSync(LOG).size;
if (bytes === 0) {
  hijo.kill();
  morir(`${LOG} quedó en 0 bytes con el server andando.`, [
    "Es exactamente el estado que hace que una verificación mienta:",
    "el server contesta y el log no es suyo. Se baja el server.",
  ]);
}

console.log(`\n  Log en ${LOG} (${bytes} bytes y creciendo). Verificado que se escribe.\n`);

hijo.once("exit", (codigo) => {
  closeSync(fd);
  process.exit(codigo ?? 0);
});
