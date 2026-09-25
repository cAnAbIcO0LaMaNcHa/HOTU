/**
 * GET /api/smoke?secret=SMOKE_SECRET — CORRE las lecturas de cada página.
 *
 * ============================================================
 * POR QUÉ EXISTE: UN 307 NO PRUEBA QUE UNA PÁGINA RENDERICE
 * ============================================================
 *
 * /admin estuvo 500 en producción durante 66 commits. La consulta de
 * getArtistsInReview() nombra artists.submitted_at, y esa columna no
 * existía en main porque la migración se había corrido allá en una
 * versión anterior que todavía no la tenía.
 *
 * No lo vio nadie porque TODA la verificación post-deploy consistía en
 * pedir URLs, y el middleware devuelve 307 a /admin/* antes de renderizar
 * cuando no hay sesión. El 307 llegaba, se leía como "anda", y la página
 * no se había ejecutado ni una vez. La verificación miraba el lugar
 * equivocado y devolvía algo con forma de respuesta.
 *
 * Así que esto no pide URLs: LLAMA A LAS FUNCIONES. Si una consulta
 * nombra una columna que no existe, revienta acá, con el nombre de la
 * función y el de la página que se habría caído.
 *
 * ============================================================
 * SIN SESIÓN, A PROPÓSITO
 * ============================================================
 *
 * Va con un secreto y no con una sesión de SUPER_ADMIN, porque tiene que
 * poder correrse desde una terminal justo después de un deploy. Una
 * verificación que exige abrir un navegador y loguearse con Google es una
 * verificación que no se corre.
 *
 * Y para que eso sea seguro, NO DEVUELVE DATOS. De cada lectura devuelve
 * si anduvo, cuánto tardó y CUÁNTAS filas trajo. Nunca las filas. Un
 * chequeo de salud no es una puerta de atrás al contenido.
 *
 * ============================================================
 * SMOKE_SECRET, NO MIGRATE_SECRET. SON PODERES DISTINTOS.
 * ============================================================
 *
 * MIGRATE_SECRET abre las rutas que ALTERAN el esquema de producción, y
 * además es la segunda llave de la limpieza pre-lanzamiento, que borra
 * pedidos y boletas. Esto solo LEE, y encima devuelve conteos y nada más.
 *
 * Darles la misma llave obligaría a tener la de migraciones a mano —en
 * .env.local, en un historial de shell, en el CI— para correr una simple
 * verificación. Cuanto más seguido se usa una credencial, en más lugares
 * termina; y esta se usa después de CADA deploy. La de migraciones se usa
 * cuatro veces por tanda y con la mano en el freno.
 *
 * Así que: dos secretos, dos alcances. Rotar uno no toca el otro, y
 * filtrar el de lectura no le da a nadie una vía para tocar el esquema
 * ni la plata.
 *
 * ============================================================
 * EL ESTADO HTTP ES EL RESULTADO
 * ============================================================
 *
 * 200 si todas pasan, 500 si alguna se rompió. Así un script post-deploy
 * solo tiene que mirar el código, sin parsear nada:
 *
 *   curl -fsS "$BASE/api/smoke?secret=$SMOKE_SECRET" || echo ROTO
 *
 * ============================================================
 * SI AGREGÁS UNA PÁGINA, AGREGÁ SUS LECTURAS ACÁ
 * ============================================================
 *
 * Esta lista es a mano y no se genera sola, así que puede quedar
 * incompleta — y una lista incompleta que dice "todo OK" es justamente la
 * clase de cosa contra la que existe este archivo. Por eso la respuesta
 * incluye `sanas`, con las páginas cuyas lecturas pasaron TODAS: si la
 * página que te preocupa no está ahí, este 200 no habla de ella.
 */

import { NextResponse } from "next/server";
import {
  getAllArtists,
  getAllCollectives,
  getAllEvents,
  getAllNews,
  getAllSets,
  getAllTracks,
  getAllVenues,
  getArtistsInReview,
  getBannedAccounts,
  getBranchesWithContent,
  getCensored,
  getCollectiveMembers,
  getFilterOptions,
  getGenreIndex,
  getLineupsByEvent,
  getLineupsPendientes,
  getNewsInReview,
} from "@/lib/db";
import { getAllOrdersAdmin, getMerchCatalog } from "@/lib/orders";
import { getAllRoleAssignments } from "@/lib/roles";
import { getEliminaciones, listarCuentas } from "@/lib/accounts-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Lectura = {
  pagina: string;
  lector: string;
  ok: boolean;
  ms: number;
  /** Cuántas filas trajo. NUNCA las filas. */
  filas: number | null;
  error?: string;
  /** Por qué no se pudo probar, cuando no se pudo. */
  omitido?: string;
};

/** El tamaño de lo que devolvió, sea array, Map, objeto o nada. */
function tamano(v: unknown): number | null {
  if (Array.isArray(v)) return v.length;
  if (v instanceof Map || v instanceof Set) return v.size;
  if (v && typeof v === "object") return Object.keys(v).length;
  return v === null || v === undefined ? null : 1;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.SMOKE_SECRET || searchParams.get("secret") !== process.env.SMOKE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resultados: Lectura[] = [];

  const correr = async (pagina: string, lector: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      const v = await fn();
      resultados.push({ pagina, lector, ok: true, ms: Date.now() - t0, filas: tamano(v) });
    } catch (e) {
      resultados.push({
        pagina,
        lector,
        ok: false,
        ms: Date.now() - t0,
        filas: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const omitir = (pagina: string, lector: string, porque: string) =>
    resultados.push({ pagina, lector, ok: true, ms: 0, filas: null, omitido: porque });

  /**
   * Dos lecturas necesitan un argumento REAL, así que van primero y
   * aparte: alimentar a getLineupsByEvent con [] o a getFilterOptions con
   * {} haría que ni toquen la base, y el OK no diría nada.
   */
  let idsDeEventos: number[] = [];
  try {
    const eventos = await getAllEvents();
    idsDeEventos = eventos.slice(0, 5).map((e) => e.id);
  } catch {
    /* getAllEvents se reporta igual más abajo, con su error */
  }

  let indiceArtistas: Awaited<ReturnType<typeof getGenreIndex>> | null = null;
  try {
    indiceArtistas = await getGenreIndex("artist");
  } catch {
    /* idem */
  }

  /* ================= PÚBLICAS ================= */
  await correr("/", "getAllEvents", () => getAllEvents());
  await correr("/", "getAllArtists", () => getAllArtists());
  await correr("/", "getAllNews", () => getAllNews());
  await correr("/", "getAllTracks", () => getAllTracks());
  await correr("/", "getBranchesWithContent", () => getBranchesWithContent());
  if (idsDeEventos.length > 0) {
    await correr("/", "getLineupsByEvent", () => getLineupsByEvent(idsDeEventos));
  } else {
    omitir("/", "getLineupsByEvent", "no hay eventos con los que probarla");
  }

  await correr("/colectivos", "getAllCollectives", () => getAllCollectives());
  await correr("/colectivos", "getCollectiveMembers", () => getCollectiveMembers("collective"));
  await correr("/colectivos", "getGenreIndex(collective)", () => getGenreIndex("collective"));
  await correr("/venues", "getAllVenues", () => getAllVenues());
  await correr("/venues", "getCollectiveMembers(venue)", () => getCollectiveMembers("venue"));
  await correr("/artistas", "getGenreIndex(artist)", () => getGenreIndex("artist"));
  if (indiceArtistas) {
    await correr("/artistas", "getFilterOptions", () => getFilterOptions(indiceArtistas));
  } else {
    omitir("/artistas", "getFilterOptions", "getGenreIndex falló, no hay índice que pasarle");
  }
  await correr("/sets", "getAllSets", () => getAllSets());
  await correr("/discografia", "getAllTracks", () => getAllTracks());
  await correr("/tienda", "getMerchCatalog", () => getMerchCatalog());

  /* ================= ADMIN =================
   * Estas son las que nadie había ejecutado nunca contra producción.
   */
  await correr("/admin", "getArtistsInReview", () => getArtistsInReview());
  await correr("/admin", "getNewsInReview", () => getNewsInReview());
  await correr("/admin", "getLineupsPendientes", () => getLineupsPendientes());
  await correr("/admin", "getCensored", () => getCensored());
  await correr("/admin", "getBannedAccounts", () => getBannedAccounts());
  await correr("/admin/moderacion", "getEliminaciones", () => getEliminaciones());
  await correr("/admin/roles", "getAllRoleAssignments", () => getAllRoleAssignments());
  await correr("/admin/pedidos", "getAllOrdersAdmin", () => getAllOrdersAdmin());
  await correr("/admin/limpieza", "listarCuentas", () => listarCuentas());

  const roto = resultados.filter((r) => !r.ok);
  const omitidas = resultados.filter((r) => r.omitido);

  /**
   * SANAS son las páginas cuyas lecturas pasaron TODAS. No las que tienen
   * alguna que pasó.
   *
   * La primera versión decía `cubre` y listaba toda página con al menos
   * una lectura buena, así que con /admin roto igual aparecía ahí. Se
   * podía leer como "/admin está bien" mirando una sola línea. Lo
   * encontré probando el fallo real, y es la misma familia que todo lo
   * demás de este archivo: una respuesta que no distingue dos estados
   * distintos.
   *
   * Y las páginas con lecturas OMITIDAS tampoco son sanas: de esas este
   * resultado no puede hablar.
   */
  const conProblema = new Set([...roto, ...omitidas].map((r) => r.pagina));
  const sanas = [...new Set(resultados.map((r) => r.pagina))].filter((p) => !conProblema.has(p));
  const dudosas = [...conProblema];

  return NextResponse.json(
    {
      ok: roto.length === 0,
      lecturas: resultados.length,
      rotas: roto.length,
      omitidas: omitidas.length,
      /** Páginas cuyas lecturas pasaron TODAS: de estas este 200 sí habla. */
      sanas,
      /** Con algo roto u omitido. De estas este resultado NO habla. */
      dudosas,
      roto: roto.map((r) => ({ pagina: r.pagina, lector: r.lector, error: r.error })),
      resultados,
    },
    { status: roto.length === 0 ? 200 : 500 }
  );
}
