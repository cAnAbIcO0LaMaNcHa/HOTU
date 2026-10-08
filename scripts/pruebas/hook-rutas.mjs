/**
 * EL HOOK QUE DEJA IMPORTAR UN ROUTE HANDLER DE NEXT DESDE NODE.
 *
 * Next resuelve "next/server", "next/headers" y el alias "@/..." con su propio bundler. Node
 * no, así que sin esto importar un route.ts falla con ERR_MODULE_NOT_FOUND antes del primer
 * chequeo.
 *
 * Hace dos reescrituras y nada más:
 *
 *   "@/x/y"      -> <raíz>/x/y, probando .ts, .tsx y /index.ts, porque el alias de Next no
 *                   lleva extensión y el resolvedor de Node la exige.
 *   "next/algo"  -> "next/algo.js", que es cómo están publicados esos subpaths.
 *
 * NO ES UN SUSTITUTO DEL BUNDLER, y eso es deliberado. Si una ruta importa algo que esto no
 * sabe resolver, el import falla RUIDOSAMENTE y la batería la cuenta como NO MEDIDA en vez de
 * darla por buena. Esa distinción es todo el punto: una lista incompleta que dice "todo OK" es
 * justo lo que estas pruebas existen para evitar.
 */
import { pathToFileURL } from "node:url";
import { resolve as unirRuta } from "node:path";
import { existsSync } from "node:fs";

const RAIZ = process.cwd();

/** El alias de Next no lleva extensión; Node la exige. Se prueban las tres formas reales. */
function resolverAlias(especificador) {
  const base = unirRuta(RAIZ, especificador.slice(2));
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, unirRuta(base, "index.ts")]) {
    if (existsSync(cand)) return pathToFileURL(cand).href;
  }
  return null;
}

/**
 * Y LOS IMPORTS RELATIVOS SIN EXTENSIÓN, que son la mayoría dentro de lib/.
 *
 * Node quita los tipos de un .ts pero NO inventa la extensión: `from "./roles-check"` no
 * resuelve solo. TypeScript sí lo permite, así que todo el repo está escrito así y sin esto la
 * cadena de imports se corta en el primer salto entre dos archivos de lib.
 */
function resolverRelativo(especificador, padre) {
  if (!padre) return null;
  const base = new URL(especificador, padre);
  for (const ext of [".ts", ".tsx", "/index.ts"]) {
    const cand = new URL(base.href + ext);
    if (existsSync(cand)) return cand.href;
  }
  return null;
}

export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith("@/")) {
    const url = resolverAlias(especificador);
    if (url) return siguiente(url, contexto);
  }
  if (especificador.startsWith("./") || especificador.startsWith("../")) {
    const url = resolverRelativo(especificador, contexto.parentURL);
    if (url) return siguiente(url, contexto);
  }
  if (especificador.startsWith("next/") && !especificador.endsWith(".js")) {
    try {
      return await siguiente(`${especificador}.js`, contexto);
    } catch {
      /* Si el subpath no existe con .js, se deja seguir al original y que falle como quiera. */
    }
  }
  return siguiente(especificador, contexto);
}
