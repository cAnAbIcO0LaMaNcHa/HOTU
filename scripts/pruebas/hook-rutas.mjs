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
  /**
   * LA COSTURA DE LA SESIÓN, y es la única cosa que este hook SUSTITUYE en vez de resolver.
   *
   * Sin ella no se puede llamar al handler de una ruta autenticada desde node: auth() devuelve
   * null y la ruta contesta 401 antes de ejecutar nada de lo que se quiere probar.
   *
   * SON DOS VARIABLES Y NO UNA, y la primera versión las confundía. ZZ_AUTH_FALSA se lee al
   * RESOLVER el módulo y ZZ_AUTH_EMAIL al LLAMAR a auth(). Con una sola, una batería que la
   * pusiera dentro del cuerpo —después del import— ya no cambiaba nada: el módulo real ya
   * estaba resuelto, y la ruta contestaba con la auth de verdad. Pasó, y el síntoma fue un
   * error de next-auth sobre headers fuera de scope.
   *
   * VA DETRÁS DE ZZ_AUTH_FALSA a propósito. Sin la variable el hook NO redirige, así que una
   * batería que se olvide de ponerla recibe la auth de verdad y un 401 ruidoso — no una sesión
   * vacía que se cuele como anónima y haga pasar una prueba de permisos por la razón
   * equivocada.
   *
   * Y falsea la SESIÓN, nunca el ROL: isModerator y las puertas de colectivo siguen
   * consultando la base, así que una batería que quiera entrar al admin tiene que crear su
   * fila en user_roles.
   */
  if (especificador === "@/auth" && process.env.ZZ_AUTH_FALSA === "1") {
    return siguiente(pathToFileURL(unirRuta(RAIZ, "scripts/pruebas/auth-falsa.mjs")).href, contexto);
  }
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
