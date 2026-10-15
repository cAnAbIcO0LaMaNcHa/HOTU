/**
 * LECTURAS DE cities. Node-only: nunca importar desde un client component.
 *
 * ============================================================
 * EL PAÍS ES OBLIGATORIO, Y NO ES PROLIJIDAD: ES EL PLAN
 * ============================================================
 *
 * Medido contra dev, con las 171.174 filas cargadas:
 *
 *   con país:  Index Cond: (country_code = 'USA' AND clave >= 'new' AND clave < 'nex')
 *              Execution Time: 0.285 ms
 *   sin país:  Seq Scan on cities, Rows Removed by Filter: 170739
 *              Execution Time: 113.806 ms
 *
 * O sea que el país no acota una lista: acota el SCAN. Una búsqueda sin país es una ruta
 * pública que recorre la tabla entera en cada tecla, y eso no es una molestia de rendimiento,
 * es un camino para voltear el sitio desde una barra de direcciones.
 *
 * Y EL `LIKE 'prefijo%'` USA EL ÍNDICE PORQUE LA BASE ESTÁ EN COLLATION C.UTF-8 — medido en
 * pg_database. Con cualquier otra collation Postgres no puede convertir el LIKE en un rango y
 * haría falta un índice con text_pattern_ops. No se nota si cambia: el plan se degrada a Seq
 * Scan y sigue devolviendo lo mismo, nada más que lento. Es la misma familia que el
 * toISOString que funcionaba sólo con offset <= 0, así que hay una prueba que mira el PLAN.
 *
 * ============================================================
 * SE BUSCA POR LOS DOS NOMBRES, Y ESO SÍ CUESTA
 * ============================================================
 *
 * Buscar sólo por `clave` —que sale de cities.nombre— deja a "londres" sin resultados, porque
 * la fila se llama "London". En un sitio en español eso es inaceptable, y está medido: 0
 * resultados contra 2.
 *
 * El costo también está medido. El `OR` hace que Postgres deje cities_pais_clave_idx y use
 * cities_pais_poblacion_idx o un bitmap:
 *
 *   COL "bogo%"      solo clave  4,98 ms   con nombre_es  14,11 ms
 *   USA "new%"       solo clave 19,22 ms   con nombre_es  32,26 ms
 *   GBR "londres%"   solo clave  2,27 ms (0 resultados)   con nombre_es 29,04 ms (2)
 *
 * 32 ms en el peor país es barato para un autocompletado, y el país sigue acotando el scan
 * —que es la propiedad que importa—. POR ESO LA PRUEBA NO EXIGE UN NOMBRE DE ÍNDICE: exige
 * que no haya Seq Scan sobre cities y que el país esté en la condición. Pedir
 * cities_pais_clave_idx por nombre fallaría con esta consulta, que es correcta.
 *
 * Esta es justamente la decisión que el BACKFILL tomó al revés, y a propósito: él no mira
 * nombre_es porque elige solo, y una segunda vía de emparejamiento le agrega ambigüedad.
 * Acá elige una persona, que ve las opciones en pantalla.
 */

import { neon } from "@neondatabase/serverless";
import { normalizarNombre } from "./lineup-import";
import { paises } from "./paises";
import { normalizarEnSql } from "./convocatorias";
import type { Ciudad } from "./ciudades-tipos";

const sql = neon(process.env.DATABASE_URL!);

/** Mínimo de caracteres para buscar. Con uno solo, "a%" en USA trae miles y no ayuda a nadie. */
export const MINIMO_PARA_BUSCAR = 2;

/** Cuántas se ofrecen. Una lista más larga que esto no se lee, se revuelve. */
export const MAXIMO_RESULTADOS = 8;

let codigosValidos: Set<string> | null = null;

/**
 * Si el código de país es uno de los 250 de lib/paises.ts.
 *
 * Se valida contra esa lista y NO contra la base, aunque la base lo sabría: un código que no
 * existe tiene que cortar ANTES de llegar a Postgres, porque el punto de exigir el país es no
 * dejar que una consulta sin acotar llegue nunca.
 */
export function paisValido(pais: string): boolean {
  if (!codigosValidos) codigosValidos = new Set(paises().map((p) => p.codigo));
  return codigosValidos.has(pais);
}

/**
 * EL PATRÓN SE ARMA EN JS, Y LOS METACARACTERES DE LIKE SE ESCAPAN.
 *
 * Sin escapar, alguien que teclea `%` manda `clave LIKE '%%'`, que matchea TODO: la consulta
 * deja de estar acotada por el prefijo y vuelve a recorrer el país entero. El `_` es más
 * sutil —matchea un carácter cualquiera— y la barra invertida es el carácter de escape de LIKE
 * en Postgres, así que sin tratarla una entrada terminada en `\` deja el patrón roto.
 *
 * Se normaliza con normalizarNombre (JS) y no con normalizarEnSql, y eso es seguro porque la
 * equivalencia de los dos normalizadores es un invariante MEDIDO del repo, no una esperanza:
 * hay una batería que los corre contra los mismos casos y exige que coincidan. Normalizar en
 * JS es lo que permite escapar después, con el string ya hecho; al revés —escapar y después
 * pasarlo por translate y regexp_replace del lado de Postgres— las barras invertidas quedan a
 * merced de dos funciones más.
 */
export function patronDe(consulta: string): string | null {
  const limpio = normalizarNombre(consulta);
  if (limpio.length < MINIMO_PARA_BUSCAR) return null;
  const escapado = limpio.replace(/[\\%_]/g, (c) => "\\" + c);
  return escapado + "%";
}

const COLUMNAS = "geonames_id, nombre, nombre_es, country_code, admin1, poblacion";

type FilaCiudad = {
  geonames_id: number;
  nombre: string;
  nombre_es: string | null;
  country_code: string;
  admin1: string | null;
  poblacion: number;
};

const aCiudad = (r: FilaCiudad): Ciudad => ({
  id: Number(r.geonames_id),
  nombre: r.nombre,
  nombreEs: r.nombre_es,
  pais: r.country_code,
  admin1: r.admin1,
  poblacion: Number(r.poblacion),
});

/**
 * LA CONSULTA DEL AUTOCOMPLETADO, EXPORTADA PARA PODER EXPLICARLA.
 *
 * No está acá por elegancia: la batería corre EXPLAIN sobre ESTE string y exige que el plan no
 * sea un Seq Scan sobre cities y que el país esté en la condición del índice. Si la batería
 * escribiera su propia copia de la consulta, lo único que probaría es que sabe escribirla —y
 * el día que esta cambiara y dejara de usar el índice, la prueba seguiría en verde.
 *
 * $1 es el país (alpha-3) y $2 el patrón ya normalizado y escapado por patronDe().
 *
 * ORDENADO POR POBLACIÓN DESC, que es lo único que hace usable una lista de homónimos: con
 * seis "Buenavista" en Colombia, la que alguien quiso decir es casi siempre la más grande, y
 * las otras cinco siguen abajo para elegirlas. No hay desempate después de la población y no
 * hace falta: es un selector y elige una persona. El backfill NO desempata nunca, justamente
 * porque elige solo.
 */
export function sqlDeBusqueda(tope: number): string {
  const n = Math.min(Math.max(1, Math.trunc(tope)), MAXIMO_RESULTADOS);
  /**
   * DOS RAMAS INDEXADAS UNIDAS, NO UN `OR`.
   *
   * Con el OR, Postgres no podía usar ningún índice para las dos condiciones a la vez y
   * terminaba recorriendo el país completo y filtrando. Medido antes del cambio:
   *
   *   USA "new"   descartaba 17.096 de las 17.343 filas del país   18,9 ms
   *   IND "mum"   descartaba  7.112 de las  7.113                   2,2 ms
   *
   * O sea el país entero leído en cada tecla. Cada rama por separado SÍ tiene su índice
   * —cities_pais_clave_idx y cities_pais_clave_es_idx— y el UNION deja que Postgres use los
   * dos y junte ocho filas de cada lado.
   *
   * EL LIMIT VA ADENTRO DE CADA RAMA, y es lo que hace la diferencia: sin él, cada rama
   * materializaría todas sus coincidencias —"san" en México son cientos— antes de recortar.
   * Con el LIMIT adentro, cada lado es un Index Scan con un top-N de ocho.
   *
   * UNION Y NO UNION ALL, porque una ciudad cuyo nombre local y español empiezan igual
   * matchea las dos ramas y aparecería repetida. Las columnas son las mismas y geonames_id es
   * la PK, así que la deduplicación por fila completa es exacta.
   *
   * `clave_es IS NOT NULL` ESTÁ DE MÁS Y VA IGUAL: el LIKE ya lo implica, pero el índice es
   * PARCIAL sobre ese mismo predicado y escribirlo hace la implicación trivial de probar. Si
   * Postgres no la probara, ignoraría el índice en silencio y la consulta seguiría dando los
   * mismos resultados, nada más que lenta. La batería exige que el plan nombre los dos índices.
   */
  const rama = (col: string, extra = "") =>
    `(SELECT ${COLUMNAS} FROM cities
        WHERE country_code = $1 ${extra} AND ${col} LIKE $2
        ORDER BY poblacion DESC LIMIT ${n})`;
  return `SELECT ${COLUMNAS} FROM (
      ${rama("clave")}
      UNION
      ${rama("clave_es", "AND clave_es IS NOT NULL")}
    ) q
    ORDER BY poblacion DESC, nombre ASC
    LIMIT ${n}`;
}

/**
 * Las ciudades de un país cuyo nombre —local o español— empieza con la consulta.
 *
 * Devuelve [] en vez de lanzar cuando el país no existe o la consulta es demasiado corta: es
 * un autocompletado, y cada tecla pasa por acá. Quien necesite distinguir "no hay" de "no
 * pregunté" tiene paisValido() y patronDe() a mano, que es lo que hace la ruta para devolver
 * un 400 de verdad.
 */
export async function buscarCiudades(
  pais: string,
  consulta: string,
  limite = MAXIMO_RESULTADOS
): Promise<Ciudad[]> {
  if (!paisValido(pais)) return [];
  const patron = patronDe(consulta);
  if (!patron) return [];
  const tope = Math.min(Math.max(1, Math.trunc(limite)), MAXIMO_RESULTADOS);
  const filas = (await sql(sqlDeBusqueda(tope), [pais, patron])) as FilaCiudad[];
  return filas.map(aCiudad);
}

/**
 * EL PLAN DE LA BÚSQUEDA, PARA PODER MIRARLO EN PRODUCCIÓN.
 *
 * Existe porque el DATABASE_URL de main no está en localhost —a propósito— así que un EXPLAIN
 * contra producción sólo lo puede correr algo que viva adentro de producción. Lo usa
 * /api/smoke, que va con SMOKE_SECRET.
 *
 * EXPLICA LA CONSULTA REAL, la que devuelve sqlDeBusqueda, y no una copia: una copia sólo
 * probaría que sé escribirla, y el día que la de verdad cambiara el chequeo seguiría en verde.
 *
 * Devuelve el texto del plan y nada más. Quien llama decide qué leer de ahí; acá no se
 * interpreta, porque interpretar de dos formas distintas en dos lugares es cómo las dos se
 * desincronizan.
 */
export async function explicarBusqueda(pais: string, patron: string): Promise<string> {
  const filas = (await sql(`EXPLAIN (ANALYZE) ${sqlDeBusqueda(MAXIMO_RESULTADOS)}`, [
    pais,
    patron,
  ])) as { "QUERY PLAN": string }[];
  return filas.map((f) => f["QUERY PLAN"]).join("\n");
}

/** Cuántas ciudades tiene un país. Sirve para poner el número de filas descartadas en escala. */
export async function contarCiudadesDePais(pais: string): Promise<number> {
  const [r] = (await sql(`SELECT COUNT(*)::int AS n FROM cities WHERE country_code = $1`, [
    pais,
  ])) as { n: number }[];
  return Number(r.n);
}

/**
 * SI EL PLAN DE LA BÚSQUEDA ES SANO. CUATRO INTENTOS, Y VALE LA PENA QUE QUEDEN LOS CUATRO.
 *
 * ============================================================
 * LOS TRES QUE FALLARON, Y POR QUÉ
 * ============================================================
 *
 * 1. "por debajo de 100 ms" — falló con la caché fría después de dos reescrituras de la
 *    tabla. Reprobó algo que no era una regresión.
 *
 * 2. "menos de 10.000 filas descartadas" — falló con USA, que descarta su país entero en una
 *    rama de forma legítima. Otra vez un número mío reprobando una consulta correcta.
 *
 * 3. "descartadas > filas del país" — ESE NO PODÍA DISPARAR NUNCA, y es el peor de los tres
 *    porque parecía razonable. Medido quitándole el índice a clave_es en dev: el plan malo
 *    descarta 17.275 de las 17.343 de USA y 7.113 de las 7.113 de India. Recorrer el país
 *    descarta COMO MÁXIMO el país, así que un `>` es imposible y un `<=` pasa en los dos
 *    estados. La aserción decía OK justo donde tenía que gritar, y sólo se vio probando al
 *    revés.
 *
 * 4. "las dos claves en la condición del índice" — falló con MEX "san", y ahí el error era
 *    distinto: prohibía un plan MEJOR. "san" tiene cientos de coincidencias en México, así
 *    que Postgres recorre por población y corta a las ocho, descartando 109 de 8.947. Eso es
 *    más barato que ir por el índice de clave y después ordenar. Las dos ramas NO son
 *    simétricas.
 *
 * ============================================================
 * LO QUE SÍ DISTINGUE LOS DOS PLANES
 * ============================================================
 *
 * LA RAMA DE clave_es, ESTRUCTURALMENTE. No tiene plan alternativo: nada más que
 * cities_pais_clave_es_idx puede responder `clave_es LIKE`. Medido, las dos formas:
 *
 *   BIEN  Index Cond: (country_code = 'USA' AND clave_es >= 'new' AND clave_es < 'nex')
 *   MAL   Index Cond: (country_code = 'USA')
 *         Filter: (clave_es IS NOT NULL AND clave_es ~~ 'new%')
 *
 * Con índice la clave entra en la CONDICIÓN; sin índice queda en un FILTRO. Eso no es un
 * número y no cambia con la caché.
 *
 * LA RAMA DE clave, EN PROPORCIÓN, porque sí tiene alternativa buena. Y acá el umbral es
 * defendible precisamente porque su valor no importa: los planes sanos descartan 0, 0, 0 y
 * 109 —el peor, 1,2% del país— y los enfermos descartan 99,6% y 100%. Cualquier corte entre
 * 2% y 98% da el mismo resultado, así que la mitad no es una elección de gusto sino el centro
 * de un hueco de 80 veces.
 */
export function juzgarPlanDeBusqueda(
  plan: string,
  filasDelPais: number
): {
  ok: boolean;
  claveEsIndexada: boolean;
  seqScan: boolean;
  descartadas: number;
  recorrioElPais: boolean;
} {
  /** Sólo las líneas de Index Cond: una mención en un Filter es justamente el caso malo. */
  const condiciones = [...plan.matchAll(/Index Cond: \((.*)\)/g)].map((m) => m[1]);
  const claveEsIndexada = condiciones.some((c) => /\bclave_es\b/.test(c));
  const seqScan = /Seq Scan on cities/.test(plan);
  const descartadas = Math.max(
    0,
    ...[...plan.matchAll(/Rows Removed by Filter: (\d+)/g)].map((m) => Number(m[1]))
  );
  const recorrioElPais = filasDelPais > 0 && descartadas >= filasDelPais / 2;
  return {
    ok: claveEsIndexada && !seqScan && !recorrioElPais,
    claveEsIndexada,
    seqScan,
    descartadas,
    recorrioElPais,
  };
}

/** Una ciudad por su id, para pintar un city_id ya guardado. null si no existe. */
export async function getCiudad(id: number): Promise<Ciudad | null> {
  if (!Number.isInteger(id)) return null;
  const filas = (await sql(
    `SELECT ${COLUMNAS} FROM cities WHERE geonames_id = $1`,
    [id]
  )) as FilaCiudad[];
  return filas.length > 0 ? aCiudad(filas[0]) : null;
}

/**
 * Varias ciudades de una, para una lista.
 *
 * Existe para que pintar veinte tarjetas no sean veinte round-trips al driver HTTP de Neon,
 * donde cada consulta es su propio request. Devuelve un Map y no un array porque el llamador
 * tiene ids, no posiciones, y un array obligaría a cada uno a rearmar el índice.
 */
export async function getCiudades(ids: number[]): Promise<Map<number, Ciudad>> {
  const limpios = [...new Set(ids.filter((n) => Number.isInteger(n)))];
  if (limpios.length === 0) return new Map();
  const filas = (await sql(
    `SELECT ${COLUMNAS} FROM cities WHERE geonames_id = ANY($1)`,
    [limpios]
  )) as FilaCiudad[];
  return new Map(filas.map((r) => [Number(r.geonames_id), aCiudad(r)]));
}
