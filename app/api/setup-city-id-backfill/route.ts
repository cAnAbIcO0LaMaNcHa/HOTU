/**
 * MIGRATION — paso 2 de la conversión a city_id: llenar lo que empareja, listar lo que no.
 *
 *   /api/setup-city-id-backfill?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-city-id-backfill?secret=YOUR_SECRET
 *
 * El paso 1 creó city_id vacía al lado del texto. Este la llena SOLO donde la respuesta es
 * única, y lo que no empareja NO SE TOCA: queda con city_id en NULL, con su texto intacto, y
 * sale listado en el log para que alguien lo mire. El texto sigue siendo la fuente de verdad
 * hasta el paso 3.
 *
 * ============================================================
 * UNA SOLA CANDIDATA O NINGUNA. NUNCA "LA MÁS GRANDE"
 * ============================================================
 *
 * Es la decisión central y es la que más cuesta no tomar al revés. Con 171.174 ciudades,
 * MEDIDO, hay 8.149 pares (país, nombre) que apuntan a más de una ciudad, y eso cubre 22.294
 * filas — el 13% de la tabla. No es un borde exótico: SOLO EN COLOMBIA hay 97 nombres
 * repetidos, con "Buenavista" seis veces y "Villanueva" cinco.
 *
 * Desempatar por población parece razonable y es exactamente el error: elegiría la Buenavista
 * del Atlántico para una fiesta que fue en la de Córdoba, y quedaría escrito como un dato
 * firme. Un city_id en NULL con el texto al lado dice "no sé"; un city_id equivocado dice
 * "sé", y nadie lo vuelve a revisar.
 *
 * Y la ambigüedad NO se puede dejar al azar del motor: un `UPDATE ... FROM cities` con dos
 * filas que matchean elige UNA sin decir cuál ni avisar. Por eso la cuenta de candidatas está
 * en el WHERE —`u.n = 1`— y no en un comentario.
 *
 * ============================================================
 * DOS TABLAS, NO CUATRO, Y POR QUÉ CADA UNA
 * ============================================================
 *
 *   events       SÍ   tiene city TEXT y country_code
 *   artists      SÍ   tiene city TEXT y country_code
 *   collectives  NO   nunca tuvo city de texto: no hay nada que convertir
 *   artist_gigs  NO   tiene city TEXT pero NO tiene country_code
 *
 * artist_gigs es el caso que hay que explicar. Sin país, "Buenavista" no tiene una respuesta
 * única ni en Colombia, y "Córdoba" es Argentina, España o Colombia. Emparejar por nombre
 * suelto sería inventar un país, así que su city_id se llena a mano desde el paso 3, cuando el
 * DJ elija la ciudad en el formulario. Hoy tiene 0 filas, así que no se pierde nada por
 * esperar — y si tuviera filas, tampoco: el texto sigue ahí.
 *
 * ============================================================
 * LA GUARDA ES city_id IS NULL, Y NO ES EL PATRÓN PROHIBIDO
 * ============================================================
 *
 * La regla del repo prohíbe que un backfill se guarde con un valor QUE LA PROPIA MIGRACIÓN
 * ESCRIBE, porque la segunda corrida se lleva puesto lo que alguien decidió a mano. Acá la
 * guarda es NULL y lo que la migración escribe es un entero: se consume una vez y la migración
 * no lo recrea nunca. Es la forma que la regla PRESCRIBE.
 *
 * Y es de una sola vía en el sentido que importa: si alguien eligió una ciudad a mano —aunque
 * el texto diga otra cosa, o no diga nada reconocible— este backfill NO la pisa.
 *
 * Que filas nuevas nazcan con city_id en NULL hasta el paso 3 es esperado, y que una corrida
 * posterior las llene también: llenar un NULL desde un texto que empareja único es la misma
 * operación, no una decisión distinta.
 *
 * ============================================================
 * EL CÓDIGO QUE ESCRIBE city TIENE QUE ANULAR city_id, Y VA PRIMERO
 * ============================================================
 *
 * Lo encontró el migration-reviewer y era el agujero de verdad. Los tres caminos que escriben
 * el texto de la ciudad —lib/artists-write.ts, lib/events-write.ts y /api/setup-test-flyer— no
 * tocaban city_id. O sea: corré este backfill, y el primer DJ que se mude de Bogotá a Medellín
 * queda con city en "Medellín" y city_id apuntando a Bogotá.
 *
 * Y NO HAY CÓMO ENTERARSE. Nada lee city_id hasta el paso 3, así que ninguna página se rompe.
 * Este backfill tampoco lo arregla: su guarda es city_id IS NULL y esa fila ya lo tiene. El
 * dato queda mal para siempre, en silencio, y se descubre en el paso 4 cuando el texto se
 * borre y lo único que quede sea el id equivocado.
 *
 * Los tres write paths ahora hacen `city_id = NULL` cuando el texto cambia, y eso IMPLICA UN
 * ORDEN DE DESPLIEGUE: ese código va a producción ANTES de correr este backfill en main.
 * Al revés queda la ventana abierta. Y ese orden es seguro en el otro sentido: con city_id
 * todavía en NULL en todas las filas, anularla no cambia nada.
 *
 * ============================================================
 * SE EMPAREJA CONTRA clave, NO CONTRA nombre_es
 * ============================================================
 *
 * cities tiene nombre_es —21.860 filas, el 12,8%— y es tentador buscar también ahí para que
 * "Londres" encuentre a London. MEDIDO sobre los datos reales: nombre_es no agrega NI UNA
 * candidata a ninguno de los valores que hay en dev. Lo que sí haría es ensanchar la
 * ambigüedad, porque una ciudad puede empatar por nombre local con una y por nombre español
 * con otra, y entonces un valor que hoy tiene respuesta única pasaría a no tener ninguna.
 *
 * Costo cero y riesgo real, así que no entra. Buscar por nombre en español es problema del
 * autocompletado del paso 3, donde lo elige una persona y se ve en pantalla.
 *
 * ============================================================
 * LOS DOS LADOS SON alpha-3, Y CASI LO DOY POR SENTADO AL REVÉS
 * ============================================================
 *
 * country_code en las tablas de contenido guarda 'COL'. En cities TAMBIÉN: medido, las 171.174
 * filas tienen largo 3. El cargador las convierte con lib/paises.ts.
 *
 * Lo anoto porque midiendo la ambigüedad pregunté por country_code = 'CO' y me dio CERO
 * claves repetidas en Colombia. Leído rápido eso dice "en Colombia no hay ambigüedad", y lo
 * que decía en realidad es "no hay ninguna fila con 'CO'". Con 'COL' son 97. Un filtro que no
 * matchea nada devuelve una lista vacía, no un error — la misma familia que verificar un
 * deploy contra un fixture de dev.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { normalizarEnSql } from "@/lib/convocatorias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las tablas que este paso llena, con su PK — que NO es la misma en las dos: events usa un id
 * serial y artists usa el slug de texto.
 */
const TABLAS = [
  { tabla: "events", pk: "id" },
  { tabla: "artists", pk: "slug" },
] as const;

/** Las que tienen city_id pero no se llenan por texto, y por qué. Va al log, no al código. */
const NO_SE_LLENAN = [
  "collectives: nunca tuvo city de texto, su city_id se elige desde el paso 3",
  "artist_gigs: tiene city de texto pero NO country_code, así que un nombre suelto no tiene respuesta única",
] as const;

type Pendiente = {
  city: string | null;
  country_code: string | null;
  filas: number;
  candidatas: number;
  /** Por qué no se toca, en palabras. Ver motivoDe(). */
  motivo: string;
};

type EstadoTabla = {
  filas: number;
  conCityId: number;
  /** Filas con city_id en NULL. Es filas - conCityId, pero medido y no restado. */
  sinCityId: number;
  /** Filas con city_id en NULL cuyo texto empareja con EXACTAMENTE una ciudad. */
  emparejables: number;
  /** Los valores distintos que quedarían sin resolver, con cuántas candidatas tiene cada uno. */
  pendientes: Pendiente[];
};

/**
 * POR QUÉ NO SE TOCA, DICHO BIEN. Un listado de pendientes que miente es peor que no tenerlo:
 * lo que lo lee es una persona que va a decidir a mano.
 *
 * Sin esta distinción, una fila sin texto de ciudad salía como "ninguna ciudad con ese
 * nombre", que manda a buscar un nombre que no existe. Hoy no puede pasar —city y
 * country_code son NOT NULL en events y en artists, medido—, y va igual: el día que esta
 * función cubra artist_gigs, que no tiene country_code, el caso es la mayoría.
 */
function motivoDe(p: { city: string | null; country_code: string | null; clave: string | null; candidatas: number }): string {
  if (p.city === null || p.clave === null || p.clave === "") return "la fila no tiene texto de ciudad";
  if (p.country_code === null) return "la fila no dice de qué país es, y un nombre suelto no tiene respuesta única";
  if (p.candidatas === 0) return "ninguna ciudad de ese país se llama así";
  return `${p.candidatas} ciudades de ese país se llaman así, y elegir una sería inventar`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  /**
   * La clave de emparejamiento del texto de la fila, normalizada del lado de Postgres con la
   * MISMA función que generó cities.clave. Que sea la misma es el punto: dos normalizadores
   * que discrepan no fallan, emparejan de menos y parece que la ciudad no existe.
   */
  const claveDe = (col: string) => normalizarEnSql(col);

  /**
   * Cuántas ciudades matchean el texto de una fila. Sale de la expresión y no de una tabla
   * auxiliar para que el conteo y el UPDATE usen exactamente la misma condición.
   */
  const candidatasDe = (alias: string) => `
    (SELECT COUNT(*)::int FROM cities c
      WHERE c.country_code = ${alias}.country_code
        AND c.clave = ${claveDe(`${alias}.city`)})`;

  const estadoDe = async (tabla: string): Promise<EstadoTabla> => {
    const [n] = await sql(`SELECT COUNT(*)::int AS n FROM ${tabla}`);
    const [conId] = await sql(`SELECT COUNT(*)::int AS n FROM ${tabla} WHERE city_id IS NOT NULL`);
    const [sinId] = await sql(`SELECT COUNT(*)::int AS n FROM ${tabla} WHERE city_id IS NULL`);
    const [emp] = await sql(`
      SELECT COUNT(*)::int AS n FROM ${tabla} t
      WHERE t.city_id IS NULL AND t.city IS NOT NULL AND ${claveDe("t.city")} <> ''
        AND ${candidatasDe("t")} = 1`);
    /**
     * EL `IS NOT TRUE` DEL HAVING, Y NO `<> 1`.
     *
     * candidatasDe cuenta con COUNT(*), que no devuelve NULL — pero las otras dos condiciones
     * del emparejamiento sí pueden: con city en NULL, `clave <> ''` da NULL y la fila queda
     * fuera de `emparejables` sin aparecer en `pendientes`. Entonces las dos cifras no sumarían
     * el total y la verificación de la partición lo diría, que es exactamente para lo que está.
     *
     * Escribir la condición como la NEGACIÓN de "es emparejable" —y con IS NOT TRUE, que trata
     * NULL como "no"— hace que las dos consultas partan el mismo conjunto por construcción.
     */
    const pend = await sql(`
      SELECT t.city, t.country_code, ${claveDe("t.city")} AS clave,
             COUNT(*)::int AS filas, ${candidatasDe("t")} AS candidatas
      FROM ${tabla} t
      WHERE t.city_id IS NULL
      GROUP BY t.city, t.country_code, 3
      HAVING (t.city IS NOT NULL AND ${claveDe("t.city")} <> '' AND ${candidatasDe("t")} = 1) IS NOT TRUE
      ORDER BY 5, 1`);
    return {
      filas: n.n as number,
      conCityId: conId.n as number,
      sinCityId: sinId.n as number,
      emparejables: emp.n as number,
      pendientes: pend.map((r) => ({
        city: (r.city as string | null) ?? null,
        country_code: (r.country_code as string | null) ?? null,
        filas: r.filas as number,
        candidatas: r.candidatas as number,
        motivo: motivoDe({
          city: (r.city as string | null) ?? null,
          country_code: (r.country_code as string | null) ?? null,
          clave: (r.clave as string | null) ?? null,
          candidatas: r.candidatas as number,
        }),
      })),
    };
  };

  /**
   * LA MEDICIÓN SE VERIFICA A SÍ MISMA, Y CORRE EN LOS DOS CAMINOS.
   *
   * "Se llenarían 3 y quedarían 1 sin tocar" solo significa algo si 3 + 1 es exactamente la
   * cantidad de filas con city_id en NULL. Si las dos consultas usaran condiciones que no son
   * complementarias, el log diría dos números que suenan bien y no cubren el conjunto — una
   * fila se evaporaría del informe sin que nada falle.
   *
   * Esto es lo único verificable en una simulación, y por eso el dryRun también devuelve
   * `verificado`: tenerlo solo en la corrida real deja sin verificar el camino que la gente
   * usa para decidir si corre la otra.
   */
  const verificarMedicion = (tabla: string, e: EstadoTabla): string[] => {
    const p: string[] = [];
    const suma = e.emparejables + e.pendientes.reduce((a, x) => a + x.filas, 0);
    if (suma !== e.sinCityId) {
      p.push(
        `${tabla}: la medición no parte el conjunto. ${e.emparejables} emparejable(s) + ` +
          `${suma - e.emparejables} sin tocar = ${suma}, y hay ${e.sinCityId} fila(s) con ` +
          "city_id en NULL."
      );
    }
    if (e.conCityId + e.sinCityId !== e.filas) {
      p.push(
        `${tabla}: ${e.conCityId} con city_id + ${e.sinCityId} sin city_id no da las ${e.filas} ` +
          "filas de la tabla."
      );
    }
    return p;
  };

  try {
    /** Sin cities no hay contra qué emparejar, y sin filas el resultado sería "nada empareja". */
    const [hayCities] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'cities'`;
    if (!hayCities) {
      return NextResponse.json(
        { ok: false, error: "Falta la tabla cities. Corré /api/setup-cities y cargala con scripts/cargar-ciudades.mjs." },
        { status: 409 }
      );
    }
    const [nCities] = await sql`SELECT COUNT(*)::int AS n FROM cities`;
    if (nCities.n === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "cities existe pero está VACÍA, así que este backfill no emparejaría nada y el log " +
            "diría que ninguna ciudad existe. Cargala con scripts/cargar-ciudades.mjs primero.",
        },
        { status: 409 }
      );
    }

    /** Y sin la columna del paso 1 no hay dónde escribir. */
    const faltanColumnas: string[] = [];
    for (const { tabla } of TABLAS) {
      const [c] = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tabla} AND column_name = 'city_id'`;
      if (!c) faltanColumnas.push(`${tabla}.city_id`);
    }
    if (faltanColumnas.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Falta ${faltanColumnas.join(", ")}. Corré /api/setup-city-id (paso 1) primero.`,
        },
        { status: 409 }
      );
    }

    const antes: Record<string, EstadoTabla> = {};
    for (const { tabla } of TABLAS) antes[tabla] = await estadoDe(tabla);

    const contarPendientes = (e: EstadoTabla) =>
      e.pendientes.reduce((acc, p) => acc + p.filas, 0);

    const lineaPendiente = (p: Pendiente) =>
      `    SIN TOCAR ${JSON.stringify(p.city)} [${p.country_code ?? "sin país"}] en ` +
      `${p.filas} fila(s): ${p.motivo}.`;

    /**
     * La huella de lo que YA tenía city_id, tomada antes de escribir. Se compara después
     * excluyendo las filas que esta corrida tocó: si alguna de las viejas se movió, difieren.
     * Es la medición que reemplaza la promesa de que el `city_id IS NULL` del WHERE alcanza.
     */
    const huellaAntes: Record<string, string> = {};
    for (const { tabla, pk } of TABLAS) {
      const [h] = await sql(
        `SELECT md5(COALESCE(string_agg(t.${pk}::text || ':' || t.city_id::text, ',' ORDER BY t.${pk}::text), '')) AS h
         FROM ${tabla} t WHERE t.city_id IS NOT NULL`
      );
      huellaAntes[tabla] = h.h as string;
    }

    if (dryRun) {
      const problemas = TABLAS.flatMap(({ tabla }) => verificarMedicion(tabla, antes[tabla]));
      log.push(
        `SIMULACIÓN. cities tiene ${nCities.n} fila(s). No se escribe nada. Se llenaría city_id ` +
          "solo donde el texto empareja con EXACTAMENTE una ciudad del mismo país."
      );
      for (const { tabla } of TABLAS) {
        const e = antes[tabla];
        log.push(
          `  ${tabla}: ${e.filas} fila(s), ${e.conCityId} ya con city_id, ` +
            `${e.emparejables} se llenarían, ${contarPendientes(e)} quedarían sin tocar.`
        );
        for (const p of e.pendientes) log.push(lineaPendiente(p));
      }
      for (const x of NO_SE_LLENAN) log.push(`  NO ENTRA ${x}`);
      log.push(
        problemas.length === 0
          ? "VERIFICADO (lo que una simulación puede verificar): cities está cargada, las dos " +
              "tablas tienen city_id, y por cada una las filas que se llenarían más las que no " +
              "suman exactamente las que hoy tienen city_id en NULL."
          : `NO VERIFICADO: ${problemas.length} problema(s) en la propia medición.`
      );
      for (const x of problemas) log.push(`  - ${x}`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: problemas.length === 0,
        problemas,
        antes,
        log,
      });
    }

    /**
     * El UPDATE, uno por tabla.
     *
     * La CTE agrupa por fila y cuenta candidatas ANTES de decidir, así que `u.n = 1` es lo que
     * descarta la ambigüedad. `min(geonames_id)` solo se usa cuando n = 1, o sea que es el
     * único valor: no es un desempate disfrazado.
     *
     * Y `city_id IS NULL` ESTÁ DOS VECES, en la CTE y en el WHERE de afuera, que parece
     * redundante y no lo es. Postgres en READ COMMITTED no recalcula la CTE: entre que la CTE
     * saca su foto y el UPDATE escribe, otra transacción puede haberle puesto un city_id a esa
     * fila, y el WHERE de afuera reevalúa SOLO lo que tiene escrito. Sin la guarda repetida, la
     * elección de esa otra transacción se pierde sin dejar rastro.
     *
     * Hoy la ventana es de milisegundos y nada más escribe city_id. Desde el paso 3 sí, y
     * entonces el bug ya estaría puesto.
     *
     * Y lleva RETURNING porque "la segunda corrida no hizo nada" tiene que ser una medición y
     * no una afirmación.
     */
    const tocadas: Record<string, { fila: string; city: string; city_id: number }[]> = {};
    for (const { tabla, pk } of TABLAS) {
      const filas = await sql(`
        WITH candidatas AS (
          SELECT t.${pk} AS fila, COUNT(*)::int AS n, MIN(c.geonames_id) AS geonames_id
          FROM ${tabla} t
          JOIN cities c
            ON c.country_code = t.country_code
           AND c.clave = ${claveDe("t.city")}
          WHERE t.city_id IS NULL
            AND t.city IS NOT NULL
            AND ${claveDe("t.city")} <> ''
          GROUP BY t.${pk}
        )
        UPDATE ${tabla} t
        SET city_id = u.geonames_id
        FROM candidatas u
        WHERE t.${pk} = u.fila AND u.n = 1 AND t.city_id IS NULL
        RETURNING t.${pk}::text AS fila, t.city, t.city_id`);
      tocadas[tabla] = filas.map((r) => ({
        fila: r.fila as string,
        city: r.city as string,
        city_id: r.city_id as number,
      }));
    }

    const despues: Record<string, EstadoTabla> = {};
    for (const { tabla } of TABLAS) despues[tabla] = await estadoDe(tabla);

    /**
     * LA VERIFICACIÓN MIDE LO QUE ESCRIBIÓ ESTA CORRIDA, no el estado entero de la columna.
     *
     * La distinción me costó un intento. La primera versión preguntaba si TODA fila con
     * city_id apunta a la ciudad que dice su texto, y hacía fallar `verificado` si no. Suena
     * más estricto y es peor: la corrección obvia para el events.city que dice
     * "Calle 80 # 14 - 11" es ponerle a mano el city_id de Bogotá, y ahí el texto deja de
     * coincidir PARA SIEMPRE. Con esa regla, la corrida siguiente diría NO VERIFICADO por una
     * fila que alguien arregló bien — y un `verificado` que grita por algo legítimo es un
     * `verificado` que se empieza a ignorar.
     *
     * Así que la incoherencia se CUENTA y se informa, pero no falla. Lo que falla es:
     *
     *   1. que quede una fila emparejable sin city_id — el trabajo a medias;
     *   2. que una fila que ESTA corrida llenó no apunte a la única candidata de su texto;
     *   3. que la cuenta no cierre: las de antes más las tocadas;
     *   4. que haya cambiado el city_id de una fila que ya lo tenía.
     *
     * La 4 la garantiza el `city_id IS NULL` del WHERE, pero eso es una promesa del código.
     * La medición es un md5 sobre los pares (pk, city_id) de las filas que ya lo tenían,
     * tomado antes y después, excluyendo las tocadas. Si alguna se movió, los dos difieren.
     */
    const problemas: string[] = [];
    const incoherentes: Record<string, number> = {};
    for (const { tabla, pk } of TABLAS) {
      const e = despues[tabla];
      const pks = tocadas[tabla].map((t) => t.fila);

      /** 0. La misma verificación de la medición que corre en el dryRun. */
      problemas.push(...verificarMedicion(tabla, e));

      if (e.emparejables !== 0) {
        problemas.push(`${tabla}: quedaron ${e.emparejables} fila(s) emparejables sin city_id`);
      }

      /** 2. Cada fila llenada ahora, contra la única candidata de su propio texto. */
      if (pks.length > 0) {
        const [chequeo] = await sql(
          `SELECT COUNT(*)::int AS vistas,
                  COUNT(*) FILTER (
                    WHERE t.city_id IS NULL
                       OR c.country_code <> t.country_code
                       OR c.clave <> ${claveDe("t.city")}
                       OR ${candidatasDe("t")} <> 1
                  )::int AS mal
           FROM ${tabla} t LEFT JOIN cities c ON c.geonames_id = t.city_id
           WHERE t.${pk}::text = ANY($1)`,
          [pks]
        );
        if (chequeo.vistas !== pks.length) {
          problemas.push(
            `${tabla}: el RETURNING reportó ${pks.length} fila(s) tocada(s) y la base encuentra ` +
              `${chequeo.vistas}.`
          );
        }
        if (chequeo.mal > 0) {
          problemas.push(
            `${tabla}: ${chequeo.mal} de las ${pks.length} fila(s) que llenó esta corrida NO ` +
              "apuntan a la única candidata de su propio texto."
          );
        }
      }

      /** 3. La aritmética. */
      const esperado = antes[tabla].conCityId + tocadas[tabla].length;
      if (e.conCityId !== esperado) {
        problemas.push(
          `${tabla}: ahora hay ${e.conCityId} fila(s) con city_id y la cuenta daba ${esperado} ` +
            `(${antes[tabla].conCityId} de antes + ${tocadas[tabla].length} tocadas).`
        );
      }

      /** 4. Que no se movió nada de lo que ya tenía city_id. */
      const huella = await sql(
        `SELECT md5(COALESCE(string_agg(t.${pk}::text || ':' || t.city_id::text, ',' ORDER BY t.${pk}::text), '')) AS h
         FROM ${tabla} t
         WHERE t.city_id IS NOT NULL AND NOT (t.${pk}::text = ANY($1))`,
        [pks]
      );
      if (huella[0].h !== huellaAntes[tabla]) {
        problemas.push(
          `${tabla}: cambió el city_id de alguna fila que YA lo tenía. Esta migración solo ` +
            "escribe donde city_id es NULL, así que esto no debería poder pasar."
        );
      }

      /**
       * Informativo, no falla: ver el comentario de arriba.
       *
       * Con IS DISTINCT FROM y no con `<>`, porque una fila con city_id puesto y city en NULL
       * daría NULL en la comparación y no se contaría — justo la fila más sospechosa de todas
       * se caería del conteo sin que nada lo diga.
       */
      const [mal] = await sql(`
        SELECT COUNT(*)::int AS n
        FROM ${tabla} t JOIN cities c ON c.geonames_id = t.city_id
        WHERE t.city_id IS NOT NULL
          AND (c.country_code IS DISTINCT FROM t.country_code
               OR c.clave IS DISTINCT FROM ${claveDe("t.city")})`);
      incoherentes[tabla] = mal.n as number;
    }

    const verificado = problemas.length === 0;
    const total = TABLAS.reduce((a, { tabla }) => a + tocadas[tabla].length, 0);

    log.push(
      total === 0
        ? "No se llenó ninguna fila. En una segunda corrida es lo correcto: la guarda es " +
            "city_id IS NULL y la primera ya las consumió."
        : `Se llenó city_id en ${total} fila(s), contadas con RETURNING.`
    );
    for (const { tabla } of TABLAS) {
      const e = despues[tabla];
      log.push(
        `  ${tabla}: ${tocadas[tabla].length} llenada(s) ahora, ${e.conCityId} de ${e.filas} con ` +
          `city_id, ${contarPendientes(e)} sin tocar.`
      );
      for (const t of tocadas[tabla]) {
        log.push(`    ${t.fila}: ${JSON.stringify(t.city)} -> ${t.city_id}`);
      }
      for (const p of e.pendientes) {
        log.push(`${lineaPendiente(p)} Queda con city_id en NULL y su texto intacto.`);
      }
      /**
       * El conteo informativo, con su significado dicho. NO afirma de dónde salió: desde que
       * el write path anula city_id al cambiar el texto, la causa más probable es que alguien
       * eligió una ciudad a mano para una fila cuyo texto no la nombra — y eso está BIEN.
       */
      if (incoherentes[tabla] > 0) {
        log.push(
          `    INFORMATIVO: ${tabla} tiene ${incoherentes[tabla]} fila(s) cuyo city_id no ` +
            "coincide con su propio texto. No es un problema por sí mismo: puede ser una " +
            "ciudad elegida a mano para un texto que no la nombra. No se tocan."
        );
      }
    }
    for (const x of NO_SE_LLENAN) log.push(`  NO ENTRA ${x}`);

    log.push(
      verificado
        ? "VERIFICADO: la medición parte el conjunto, no quedó ninguna fila emparejable sin " +
            "city_id, cada fila que ESTA corrida llenó apunta a la única candidata de su propio " +
            "texto, la cuenta da las de antes más las tocadas, y la huella de las que ya tenían " +
            "city_id no cambió."
        : `NO VERIFICADO: ${problemas.length} problema(s).`
    );
    for (const x of problemas) log.push(`  - ${x}`);

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado,
      problemas,
      llenadas: total,
      incoherentes,
      antes,
      despues,
      tocadas,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
