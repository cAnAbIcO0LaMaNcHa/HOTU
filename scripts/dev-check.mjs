/**
 * Aborta si ya hay un dev server sobre este .next.
 *
 * Dos procesos `next dev` sobre el mismo directorio se pisan los
 * vendor-chunks. El server compila sin quejarse y después cada request
 * muere con "Cannot find module './vendor-chunks/next.js'", un síntoma
 * que no dice absolutamente nada sobre la causa. Ya pasó tres veces, y
 * las tres se fue el tiempo en diagnosticar el síntoma en vez de mirar
 * la lista de procesos.
 *
 * Esto lo convierte en un mensaje claro antes de romper nada. Se corre
 * solo, como parte de `npm run dev`.
 *
 * Detecta por PUERTO, no por lista de procesos: es lo único que funciona
 * igual en Windows, macOS y Linux, y el puerto ocupado es exactamente la
 * condición que importa. Un `next dev` zombi que ya soltó el puerto no
 * hace daño.
 *
 * Y detecta CONECTANDO, no intentando bindear. Bindear no sirve en
 * Windows: next dev escucha en 0.0.0.0 y en [::], y aun así Windows deja
 * bindear 127.0.0.1 sin dar EADDRINUSE, con lo cual el chequeo decía
 * "libre" con el server andando al lado. Si alguien acepta una conexión
 * en el puerto, está ocupado, y eso es igual en los tres sistemas.
 */

import { connect } from "node:net";

const PORT = Number(process.env.PORT ?? 3000);

/** ¿Hay alguien aceptando conexiones en el puerto? */
function puertoLibre(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const cerrar = (libre) => {
      socket.destroy();
      resolve(libre);
    };
    socket.setTimeout(2000);
    // Conectó: hay algo escuchando.
    socket.once("connect", () => cerrar(false));
    // ECONNREFUSED es el caso bueno: no hay nadie.
    socket.once("error", () => cerrar(true));
    socket.once("timeout", () => cerrar(true));
  });
}

/** ¿Lo que está escuchando es un HOTU? Para no confundir con otra app. */
async function esHotu(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/auth/session`, {
      signal: AbortSignal.timeout(8000),
    });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

if (await puertoLibre(PORT)) {
  process.exit(0);
}

const mio = await esHotu(PORT);

console.error("");
console.error(`  El puerto ${PORT} ya está ocupado${mio ? " por un dev server de HOTU" : ""}.`);
console.error("");
console.error("  NO arranques un segundo server sobre el mismo .next: los dos");
console.error("  escriben los mismos vendor-chunks y el resultado es que cada");
console.error("  request muere con \"Cannot find module './vendor-chunks/next.js'\",");
console.error("  que no se parece en nada a la causa real.");
console.error("");
console.error("  Si el que está sirviendo te sirve, usalo. Si no:");
console.error("");
console.error("    1. Matá TODOS los node de HOTU, no solo el padre.");
console.error("       El padre deja hijos vivos que siguen escribiendo .next.");
console.error("");
console.error("       Windows:  Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |");
console.error("                   Where-Object { $_.CommandLine -like '*HOTU*' } |");
console.error("                   ForEach-Object { Stop-Process -Id $_.ProcessId -Force }");
console.error("       Unix:     pkill -f 'next dev'");
console.error("");
console.error("    2. rm -rf .next");
console.error("    3. npm run dev");
console.error("");
console.error("  Para levantar uno en otro puerto a propósito: PORT=3001 npm run dev");
console.error("");
process.exit(1);
