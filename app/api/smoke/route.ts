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
  getArtistBySlug,
  getArtistsInReview,
  getBannedAccounts,
  countArtistLikes,
  getBranchesWithContent,
  getCensored,
  getVinculos,
  getFilterOptions,
  getGenreIndex,
  getLineupsByEvent,
  getLineupsPendientes,
  getNewsInReview,
  getPhotosByArtist,
  getPressByArtist,
  getProfileGenres,
  getSetsByArtist,
  getTracksByArtist,
  getGigsByArtist,
} from "@/lib/db";
import { getAllOrdersAdmin, getMerchCatalog } from "@/lib/orders";
import { getAllRoleAssignments } from "@/lib/roles";
import { getEliminaciones, listarCuentas } from "@/lib/accounts-delete";
import { getReclamosPendientes } from "@/lib/claims-write";
import { getMailOutbox } from "@/lib/mail";
import {
  buscarCiudades,
  contarCiudadesDePais,
  explicarBusqueda,
  patronDe,
  juzgarPlanDeBusqueda,
} from "@/lib/ciudades";
import {
  getConvocatoriaDeEvento,
  getConvocatoriasAbiertas,
  getPostulacionesDeArtista,
} from "@/lib/convocatorias-read";

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

  /**
   * ============================================================
   * EL PERFIL DE ARTISTA NO TENÍA NI UNA LECTURA ACÁ
   * ============================================================
   *
   * /artistas/[slug] es la página más grande del sitio —el EPK entero— y ninguno de sus
   * seis lectores había corrido nunca contra producción desde este chequeo. Es la misma
   * forma exacta del caso que originó este archivo: /admin estuvo 500 durante 66 commits
   * porque sus lecturas no estaban en esta lista.
   *
   * Se descubrió agregando galería y prensa: la regla dice "si agregás una página, agregá
   * sus lecturas", y al ir a sumar las dos nuevas no había ninguna a la que sumarlas.
   *
   * NECESITA UN SLUG REAL, así que sale del primer artista publicado. Si no hay ninguno se
   * OMITE en vez de pasar vacío — alimentar a getArtistBySlug con un slug inventado haría
   * que devuelva null sin tocar las columnas que importan, y el OK no diría nada.
   */
  let slugDeArtista: string | null = null;
  try {
    const artistas = await getAllArtists();
    slugDeArtista = artistas[0]?.slug ?? null;
  } catch {
    /* getAllArtists se reporta igual más arriba, con su error */
  }

  if (slugDeArtista) {
    const s = slugDeArtista;
    await correr("/artistas/[slug]", "getArtistBySlug", () => getArtistBySlug(s));
    await correr("/artistas/[slug]", "getSetsByArtist", () => getSetsByArtist(s));
    await correr("/artistas/[slug]", "getTracksByArtist", () => getTracksByArtist(s));
    await correr("/artistas/[slug]", "getGigsByArtist", () => getGigsByArtist(s));
    await correr("/artistas/[slug]", "getPhotosByArtist", () => getPhotosByArtist(s));
    await correr("/artistas/[slug]", "getPressByArtist", () => getPressByArtist(s));
    await correr("/artistas/[slug]", "countArtistLikes", () => countArtistLikes(s));
    await correr("/artistas/[slug]", "getProfileGenres", () => getProfileGenres("artist", s));
    /**
     * LA BANDEJA DEL DJ CUELGA DE SU PERFIL, así que su lectura va con las del EPK y con el
     * mismo slug real. Si no hubiera artistas se OMITE junto con las otras ocho, que es lo
     * correcto: alimentarla con un slug inventado devolvería una lista vacía sin tocar los
     * JOIN que importan, y el OK no diría nada.
     */
    await correr("/artistas/[slug]", "getPostulacionesDeArtista", () =>
      getPostulacionesDeArtista(s)
    );
  } else {
    for (const lector of [
      "getArtistBySlug",
      "getSetsByArtist",
      "getTracksByArtist",
      "getGigsByArtist",
      "getPhotosByArtist",
      "getPressByArtist",
      "countArtistLikes",
      "getProfileGenres",
      "getPostulacionesDeArtista",
    ]) {
      omitir("/artistas/[slug]", lector, "no hay artistas publicados con los que probarlas");
    }
  }

  await correr("/colectivos", "getAllCollectives", () => getAllCollectives());
  await correr("/colectivos", "getVinculos", () => getVinculos("collective"));
  await correr("/colectivos", "getGenreIndex(collective)", () => getGenreIndex("collective"));

  /**
   * LAS ETIQUETAS SON PÁGINAS QUE EXISTEN, Y LA PRIMERA VERSIÓN DE ESTO INVENTÓ DOS.
   *
   * Decía /convocatorias y /admin/eventos/[id], y NINGUNA DE LAS DOS EXISTE: el distintivo de
   * convocatoria va en /eventos y el panel del dueño es /perfil?panel=colectivo. Las lecturas
   * corrían bien, así que el smoke daba verde — y listaba dos páginas sanas que no son
   * páginas.
   *
   * Es la familia de este archivo cometida DENTRO de este archivo: `sanas` existe justamente
   * para que nadie lea que una página está bien en una línea que no habla de esa página.
   *
   * OJO CON LO QUE SIGUE SIN CUBRIR: /perfil no tiene NINGUNA otra lectura acá, con sus cuatro
   * paneles. getConvocatoriaDeEvento es la primera, y entra etiquetada con el panel donde se
   * usa — pero el resto de /perfil sigue afuera, que es la misma forma del /admin que estuvo
   * 500 durante 66 commits. Anotado, no resuelto.
   */
  /**
   * LAS CONVOCATORIAS (§7).
   *
   * getConvocatoriasAbiertas es la vitrina y no necesita ningún dato previo, así que corre
   * siempre. Su consulta cruza event_calls, events y collectives y evalúa la condición de
   * ABIERTA, que es la parte que puede romperse: si alguien le cambia la forma a
   * CONVOCATORIA_ABIERTA y se le va un alias, acá se ve.
   *
   * getConvocatoriaDeEvento NECESITA UN EVENTO REAL, y se le pasa uno de los publicados por
   * la misma razón que el EPK recibe un slug real: con un id inventado devuelve null sin
   * tocar ni el JOIN de artists ni el subquery de postulaciones, y el OK no hablaría de nada.
   * Si no hay eventos se OMITE en vez de pasar vacía.
   */
  /**
   * LAS DOS RAMAS, porque el filtro de visibilidad es la parte que puede romperse. Con esDj en
   * false se agrega el AND sobre ec.visibilidad; con true no. Correr solo una dejaría la otra
   * sin ejecutar nunca contra producción, que es la forma de /admin en 500 por 66 commits.
   */
  await correr("/eventos", "getConvocatoriasAbiertas(publicas)", () =>
    getConvocatoriasAbiertas(false)
  );
  await correr("/eventos", "getConvocatoriasAbiertas(todas)", () =>
    getConvocatoriasAbiertas(true)
  );

  let idDeEvento: number | null = null;
  try {
    const eventos = await getAllEvents();
    idDeEvento = eventos[0]?.id ?? null;
  } catch {
    /* getAllEvents se reporta igual más arriba, con su error */
  }
  if (idDeEvento !== null) {
    const ev = idDeEvento;
    await correr("/perfil?panel=colectivo", "getConvocatoriaDeEvento", () =>
      getConvocatoriaDeEvento(ev)
    );
  } else {
    omitir("/perfil?panel=colectivo", "getConvocatoriaDeEvento", "no hay eventos publicados");
  }
  await correr("/venues", "getAllVenues", () => getAllVenues());
  await correr("/venues", "getVinculos(venue)", () => getVinculos("venue"));
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
  await correr("/admin/reclamos", "getReclamosPendientes", () => getReclamosPendientes());
  await correr("/admin/moderacion", "getEliminaciones", () => getEliminaciones());
  await correr("/admin/moderacion", "getMailOutbox", () => getMailOutbox());
  await correr("/admin/roles", "getAllRoleAssignments", () => getAllRoleAssignments());
  await correr("/admin/pedidos", "getAllOrdersAdmin", () => getAllOrdersAdmin());
  await correr("/admin/limpieza", "listarCuentas", () => listarCuentas());

  /**
   * EL AUTOCOMPLETADO DE CIUDADES, que no estaba y tenía que estar.
   *
   * Lo marcó el migration-reviewer: /api/ciudades es un lector NUEVO de cities y el smoke no
   * tenía ni una lectura de esa tabla, así que desplegar la consulta del selector antes de
   * correr su migración daba 500 en cada tecleo y el chequeo post-deploy NO lo veía. Es
   * exactamente la trampa que este archivo existe para evitar: una lista incompleta que dice
   * que todo está OK.
   *
   * LA CONSULTA LLEVA ARGUMENTOS REALES, por lo mismo que getLineupsByEvent más arriba:
   * buscarCiudades('', '') devolvería [] sin tocar la base y el OK no diría nada. Con
   * ('COL','bogo') tiene que traer Bogotá, así que toca el índice, la columna generada y las
   * dos ramas del UNION.
   *
   * Y ES UNA RUTA, NO UNA PÁGINA. Se nombra igual porque la pregunta que el smoke contesta es
   * "¿esta lectura sigue andando en producción?", y una ruta de API tiene esa pregunta tanto
   * como una página — con la diferencia de que a una página alguien la mira.
   */
  await correr("/api/ciudades", "buscarCiudades", () => buscarCiudades("COL", "bogo"));

  /**
   * ============================================================
   * EL PLAN DEL AUTOCOMPLETADO, MEDIDO EN LA BASE QUE SEA
   * ============================================================
   *
   * ESTO ESTÁ ACÁ PORQUE NO HAY OTRO LUGAR DONDE PUEDA ESTAR. El DATABASE_URL de main NO
   * existe en localhost, y eso es deliberado: es lo que convierte "todo contra dev" en una
   * garantía y no en una intención. Así que un EXPLAIN contra producción sólo puede correrlo
   * algo que ya viva adentro de producción.
   *
   * Y HACE FALTA, porque es la única pieza de todo el repo cuyo valor ES el plan. La búsqueda
   * en UNION devuelve exactamente lo mismo que el OR que reemplazó: si el plan se degradara
   * —estadísticas que no se juntaron, un índice que no se creó, una collation distinta— la
   * ruta seguiría contestando bien y nadie se enteraría. Ya está medido que la diferencia es
   * de 18,5 ms a 0,4 ms y de 17.096 filas descartadas a 0.
   *
   * NO DEVUELVE NI UNA FILA DE CONTENIDO, igual que el resto del smoke: nombres de índice,
   * cuántas filas descartó y cuántos milisegundos. Es metadato del planner, no datos.
   *
   * LOS DOS PAÍSES SON USA E INDIA porque son los que más duelen: 17.343 y 7.113 filas. En
   * Colombia —1.173— un plan malo tardaría poco y no se notaría, que es justamente por qué no
   * sirve medir sólo ahí.
   */
  const planes: {
    pais: string;
    consulta: string;
    ok: boolean;
    indices: string[];
    descartadas: number;
    filasDelPais: number;
    ms: number | null;
    porque?: string;
  }[] = [];

  for (const [pais, q] of [
    ["USA", "new"],
    ["IND", "mum"],
    ["COL", "bogo"],
  ] as const) {
    try {
      const patron = patronDe(q);
      if (!patron) throw new Error(`patronDe("${q}") devolvió null`);
      const filasDelPais = await contarCiudadesDePais(pais);
      const plan = await explicarBusqueda(pais, patron);
      const indices = [...new Set([...plan.matchAll(/using (\w+)/g)].map((m) => m[1]))];
      const descartadas = Math.max(
        0,
        ...[...plan.matchAll(/Rows Removed by Filter: (\d+)/g)].map((m) => Number(m[1]))
      );
      const ms = Number(plan.match(/Execution Time: ([\d.]+)/)?.[1] ?? "0");
      /**
       * EL JUICIO ES ESTRUCTURAL Y NO UN UMBRAL. Ver planBuscaLasDosClavesPorIndice(): tres
       * umbrales elegidos a mano fallaron antes de llegar acá, y el último no podía disparar
       * nunca. Lo que importa es si cada clave entra en la CONDICIÓN DEL ÍNDICE o queda en un
       * filtro, que es exactamente lo que diferencia los dos planes y no depende de la caché.
       */
      const j = juzgarPlanDeBusqueda(plan, filasDelPais);
      planes.push({
        pais,
        consulta: q,
        ok: j.ok,
        indices,
        descartadas,
        filasDelPais,
        ms,
        ...(j.ok
          ? {}
          : {
              porque: j.seqScan
                ? "Seq Scan sobre cities: recorre la tabla entera"
                : !j.claveEsIndexada
                  ? "la condición del índice no incluye clave_es, así que esa rama recorre el " +
                    `país y filtra (descartó ${descartadas} de ${filasDelPais})`
                  : `descartó ${descartadas} de las ${filasDelPais} filas del país: recorrió el país`,
            }),
      });
    } catch (e) {
      planes.push({
        pais,
        consulta: q,
        ok: false,
        indices: [],
        descartadas: 0,
        filasDelPais: 0,
        ms: null,
        porque: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const planesMalos = planes.filter((p) => !p.ok);

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

  /**
   * UN PLAN MALO TAMBIÉN DA 500, Y VA CONTADO APARTE.
   *
   * Dar 200 con el plan degradado sería la falla que este archivo entero existe para evitar:
   * alguien lee "todo OK" y el autocompletado está recorriendo la tabla en cada tecla. Así
   * que cuenta para el status.
   *
   * Pero NO entra en `roto`, que significa "la lectura se rompió". Un plan malo no es una
   * lectura rota: devuelve los datos correctos. Mezclarlos haría que el campo `rotas` dejara
   * de querer decir lo que dice, y ese es el tipo de confusión que ya corregí dos veces acá
   * mismo con `sanas`.
   */
  return NextResponse.json(
    {
      ok: roto.length === 0 && planesMalos.length === 0,
      lecturas: resultados.length,
      rotas: roto.length,
      omitidas: omitidas.length,
      /** El plan del autocompletado. Metadato del planner, nunca filas. */
      planes,
      planesMalos: planesMalos.length,
      /** Páginas cuyas lecturas pasaron TODAS: de estas este 200 sí habla. */
      sanas,
      /** Con algo roto u omitido. De estas este resultado NO habla. */
      dudosas,
      roto: roto.map((r) => ({ pagina: r.pagina, lector: r.lector, error: r.error })),
      resultados,
    },
    { status: roto.length === 0 && planesMalos.length === 0 ? 200 : 500 }
  );
}
