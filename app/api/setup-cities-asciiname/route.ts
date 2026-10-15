/**
 * MIGRATION — que la transliteración la haga GeoNames y no una tabla a mano.
 *
 *   /api/setup-cities-asciiname?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-cities-asciiname?secret=YOUR_SECRET
 *
 * ============================================================
 * EL DEFECTO QUE ARREGLA, CON SU NÚMERO
 * ============================================================
 *
 * cities.clave se genera con normalizarEnSql(nombre), que borra SEIS marcas combinantes y
 * traduce una lista Latin-1 fija. Todo diacrítico fuera de esa lista sobrevive:
 *
 *   16.310 de 171.174 claves (9,53%) quedaron con algún carácter no-ASCII.
 *
 * Y la consecuencia es concreta y medida: tipear "thane" en India da CERO resultados, porque
 * la clave guardada es "thāne" con macrón. Igual "rajkot" y "hue". El patrón que arma el
 * selector sí borra el macrón —normalizarNombre en JS hace NFD y borra el bloque entero— así
 * que los dos lados no se encuentran.
 *
 * COLOMBIA ESTÁ LIMPIA: 0 de 1.173, medido. Por eso nunca se disparó.
 *
 * ============================================================
 * LA RESPUESTA ES asciiname, Y NO UNA LISTA MÁS LARGA
 * ============================================================
 *
 * GeoNames publica asciiname en la columna 3 de cities1000.txt: su propia transliteración a
 * ASCII, hecha por quien conoce cada idioma. "Thāne" -> "Thane". "Huế" -> "Hue".
 *
 * La alternativa era alargar el translate de normalizarEnSql con macrones, breves, tonos
 * vietnamitas, puntos suscritos... Eso es escribir a mano un transliterador Unicode, y cada
 * carácter que falte vuelve a ser este mismo bug con otro número. Peor: normalizarEnSql
 * también decide si dos nombres de DJ son el mismo en el lineup, así que tocarla mueve una
 * pieza que no tiene nada que ver con esto.
 *
 * La otra alternativa era la extensión `unaccent`, que AGENTS.md ya anota como disponible en
 * Neon y no instalada. Sigue siendo una opción razonable para el lineup; para las ciudades es
 * peor que asciiname, porque unaccent adivina y GeoNames sabe.
 *
 * ============================================================
 * SET EXPRESSION, NO DROP + ADD
 * ============================================================
 *
 * clave es GENERATED ALWAYS, y hasta PostgreSQL 16 no se podía cambiar la expresión: había que
 * dropear la columna —llevándose los dos índices que dependen de ella— y recrear todo.
 *
 * Esta base es PostgreSQL 17.11, MEDIDO con version(), y 17 agregó
 * ALTER COLUMN ... SET EXPRESSION AS. Reescribe la tabla pero CONSERVA la columna y reconstruye
 * sus índices por su cuenta, así que no hay un momento en el que cities_pais_clave_idx no
 * exista. La verificación comprueba que los dos índices siguen con su definición exacta, porque
 * "lo reconstruye solo" es una promesa de la documentación y acá se mide.
 *
 * ============================================================
 * SE PUEDE CORRER ANTES DE LA RECARGA, Y NO CAMBIA NADA
 * ============================================================
 *
 * Es la propiedad que hace que esto no tenga ventana. La expresión nueva es
 *
 *     normalizar(COALESCE(NULLIF(btrim(ascii_nombre), ''), nombre))
 *
 * y ascii_nombre nace en NULL para las 171.174 filas que ya están. O sea que apenas corre la
 * migración, clave vale EXACTAMENTE lo mismo que antes, y el sitio no se mueve. Las claves
 * mejoran cuando el cargador vuelva a pasar y llene la columna.
 *
 * El NULLIF(btrim(...), '') está porque GeoNames deja asciiname vacío en algunas filas, y un
 * COALESCE pelado tomaría la cadena vacía como un valor: la clave quedaría en '' y esa ciudad
 * dejaría de poder buscarse. Vacío tiene que caer al nombre local, igual que NULL.
 *
 * ============================================================
 * Y LO QUE HAY QUE VERIFICAR NO ES LA FORMA: ES QUE NADIE PIERDA SU CIUDAD
 * ============================================================
 *
 * Cambiar clave cambia el emparejamiento, y hay filas en main que YA tienen city_id asignado
 * por el backfill. Así que la verificación cuenta, para events y artists, cuántas filas con
 * city_id dejaron de coincidir con la clave de su propia ciudad. Tiene que dar 0.
 *
 * Hoy es seguro justamente porque esas 16 filas son todas colombianas y Colombia no cambia.
 * Después de que haya perfiles de otros países, dejaría de serlo — y por eso esto va ahora.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { normalizarEnSql } from "@/lib/convocatorias";
import { normalizarNombre } from "@/lib/lineup-import";
import { estadoDeRecarga } from "@/lib/ciudades-tramo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * SET EXPRESSION REESCRIBE 171.174 FILAS Y RECONSTRUYE DOS ÍNDICES, así que esto no entra en
 * los 10 segundos que Vercel le da por omisión a una función. 60 es el techo del plan Hobby.
 *
 * Si igual se cortara, el ALTER corre dentro de una transacción: la base la aborta y la tabla
 * queda como estaba. Se pierde el trabajo, no el dato — y el reintento es gratis.
 */
export const maxDuration = 60;

/**
 * De dónde sale la clave desde ahora: el ASCII de GeoNames, y el nombre local si no hay.
 *
 * EL btrim LLEVA SU CONJUNTO DE BLANCOS EXPLÍCITO, y eso lo encontró el migration-reviewer.
 * `btrim(x)` a secas recorta SÓLO el espacio ASCII. Un ascii_nombre que fuera un espacio duro
 * U+00A0 sobrevivía al NULLIF, el COALESCE lo tomaba como valor bueno, y el normalizador de
 * abajo lo colapsaba a '' — dejando la ciudad con clave VACÍA, imposible de buscar y excluida
 * del backfill por su `<> ''`. Un tab o un salto de línea hacían lo mismo.
 *
 * Los cinco caracteres van con chr() y no como literales, por la regla del repo: un invisible
 * en el fuente es una bomba de tiempo, y acá además el que importa es justamente el invisible.
 */
const BLANCOS_DE_ASCII = "' ' || chr(9) || chr(10) || chr(13) || chr(160)";
const FUENTE_DE_CLAVE = `COALESCE(NULLIF(btrim(ascii_nombre, ${BLANCOS_DE_ASCII}), ''), nombre)`;

/**
 * LA EXPRESIÓN RENDERIZADA QUE POSTGRES GUARDA, medida en dev después de aplicarla.
 *
 * No es la que yo escribo: Postgres reescribe los literales con ::text, reordena los paréntesis
 * del `||` y normaliza el COALESCE. Comparar contra lo que yo escribí daría "no verificado"
 * para siempre. Es el mismo criterio que los FK de setup-city-id: la forma EXACTA que el motor
 * rinde, medida contra el motor.
 */
const EXPRESION_ESPERADA =
  "btrim(regexp_replace(lower(translate(translate(COALESCE(NULLIF(btrim(ascii_nombre, ((((' '::text || chr(9)) || chr(10)) || chr(13)) || chr(160))), ''::text), nombre), (((((chr(768) || chr(769)) || chr(770)) || chr(771)) || chr(776)) || chr(807)), ''::text), 'áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜãõÃÕñÑçÇ'::text, 'aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUaoAOnNcC'::text)), (('[[:space:]'::text || chr(160)) || ']+'::text), ' '::text, 'g'::text), ' '::text)";

/** Los dos índices que dependen de clave, con la definición que tienen que conservar. */
const INDICES: [string, string][] = [
  [
    "cities_pais_clave_idx",
    "CREATE INDEX cities_pais_clave_idx ON public.cities USING btree (country_code, clave)",
  ],
  [
    "cities_pais_poblacion_idx",
    "CREATE INDEX cities_pais_poblacion_idx ON public.cities USING btree (country_code, poblacion DESC)",
  ],
];

/** Las tablas cuyo city_id ya está escrito y no puede perder su ciudad. */
const CON_CITY_ID = [
  { tabla: "events", pk: "id" },
  { tabla: "artists", pk: "slug" },
] as const;

type Forma = {
  asciiNombre: { tipo: string; aceptaNull: boolean; default: string | null } | null;
  claveGenerada: boolean;
  claveExpresion: string | null;
  indices: string[];
};

type Medicion = {
  /** false cuando ascii_nombre todavía no existe: el resto de los números no significan nada. */
  columnaExiste: boolean;
  filas: number;
  conAsciiNombre: number;
  clavesNoAscii: number;
  clavesVacias: number;
  /** md5 de (geonames_id, clave) sobre toda la tabla. Si cambia, alguna clave se movió. */
  huellaDeClaves: string;
  /** Por tabla: filas con city_id cuya ciudad ya no coincide con el nombre de su texto. */
  descolgadas: Record<string, number>;
  conCityId: Record<string, number>;
  /** Las que están descolgadas, nombradas. Se corta en 20: es para mirar, no para procesar. */
  ejemplos: string[];
};

function verificarForma(f: Forma): string[] {
  const p: string[] = [];
  if (!f.asciiNombre) p.push("falta cities.ascii_nombre");
  else {
    if (!/text|character/i.test(f.asciiNombre.tipo)) {
      p.push(`cities.ascii_nombre es ${f.asciiNombre.tipo} y tiene que ser text`);
    }
    /**
     * NULLABLE A PROPÓSITO, y verificado como tal: un NOT NULL acá obligaría a llenarla en la
     * misma migración, y la gracia de esta pieza es que se puede correr ANTES de la recarga sin
     * mover una clave.
     */
    if (!f.asciiNombre.aceptaNull) p.push("cities.ascii_nombre es NOT NULL y tiene que ser nullable");
    if (f.asciiNombre.default !== null) {
      p.push(`cities.ascii_nombre tiene default ${f.asciiNombre.default} y no debería tener ninguno`);
    }
  }
  if (!f.claveGenerada) p.push("cities.clave dejó de ser GENERATED ALWAYS");
  if (f.claveExpresion === null) p.push("no pude leer la expresión de cities.clave");
  else if (f.claveExpresion !== EXPRESION_ESPERADA) {
    p.push(
      "la expresión de cities.clave NO es la esperada.\n      es:      " +
        f.claveExpresion +
        "\n      debería: " +
        EXPRESION_ESPERADA
    );
  }
  for (const [nombre, def] of INDICES) {
    const linea = f.indices.find((x) => x.startsWith(`${nombre}: `));
    if (!linea) p.push(`falta el índice ${nombre} — SET EXPRESSION tenía que reconstruirlo`);
    else if (linea.slice(nombre.length + 2) !== def) {
      p.push(
        `el índice ${nombre} quedó con otra definición.\n      es:      ${linea.slice(nombre.length + 2)}` +
          `\n      debería: ${def}`
      );
    }
  }
  /**
   * Y QUE NO SE HAYA PERDIDO NINGÚN OTRO ÍNDICE, que es el límite que señaló la revisión:
   * comprobar los dos de la lista deja pasar la desaparición de un tercero que alguien haya
   * agregado después. La cuenta es pkey + los dos de arriba = 3; cualquier otro número hay
   * que mirarlo, de más o de menos.
   */
  if (f.indices.length !== INDICES.length + 1) {
    p.push(
      `cities tiene ${f.indices.length} índice(s) y se esperaban ${INDICES.length + 1} ` +
        `(la PK más ${INDICES.length}): ${f.indices.map((x) => x.split(":")[0]).join(", ")}`
    );
  }
  return p;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const leerForma = async (): Promise<Forma> => {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default, is_generated, generation_expression
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cities'
        AND column_name IN ('ascii_nombre', 'clave')`;
    const ascii = cols.find((c) => c.column_name === "ascii_nombre");
    const clave = cols.find((c) => c.column_name === "clave");
    const idx = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'cities' ORDER BY indexname`;
    return {
      asciiNombre: ascii
        ? {
            tipo: ascii.data_type as string,
            aceptaNull: ascii.is_nullable === "YES",
            default: (ascii.column_default as string | null) ?? null,
          }
        : null,
      claveGenerada: clave?.is_generated === "ALWAYS",
      claveExpresion: (clave?.generation_expression as string | null) ?? null,
      indices: idx.map((x) => `${x.indexname}: ${x.indexdef}`),
    };
  };

  /**
   * LA MEDICIÓN QUE IMPORTA. No es la forma: es si alguien perdió su ciudad.
   *
   * ============================================================
   * LA COMPARACIÓN VA EN JS Y NO EN SQL, Y ES EL REPARO MÁS FINO QUE SALIÓ DE LA REVISIÓN
   * ============================================================
   *
   * La primera versión comparaba `c.clave` contra `normalizarEnSql(t.city)` del lado de
   * Postgres. Es correcto ANTES de la recarga y deja de serlo DESPUÉS, por el mismo defecto
   * que esta migración viene a arreglar: con events.city = 'Thāne' y el city_id correcto,
   * clave pasa a ser 'thane' (ASCII, de GeoNames) y normalizarEnSql('Thāne') sigue dando
   * 'thāne' con el macrón. La fila se contaría como descolgada estando perfecta.
   *
   * O sea que el chequeo habría empezado a gritar justo después de la recarga, que es el único
   * momento en que uno lo mira. Un verificado en falso rojo es casi tan malo como uno en falso
   * verde: entrena a ignorarlo.
   *
   * normalizarNombre (JS) hace NFD y borra el bloque combinante COMPLETO, así que 'Thāne' da
   * 'thane' y coincide con la clave nueva. Es además el MISMO normalizador que usa patronDe
   * para armar la búsqueda del selector, o sea que esto mide exactamente lo que el selector va
   * a poder encontrar.
   *
   * Se puede hacer en JS porque son pocas filas —16 en main, 21 en dev— y si alguna vez fueran
   * muchas, el tope dice cuántas miró en vez de mentir sobre el resto.
   */
  const TOPE_A_REVISAR = 5000;

  const medir = async (): Promise<Medicion> => {
    const [existe] = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = 'ascii_nombre'`;

    /**
     * SIN LA COLUMNA NO SE LA CONSULTA, y esto es el hallazgo 1 de la revisión — confirmado
     * midiendo: el dryRun devolvía 500 con `column "ascii_nombre" does not exist`, así que el
     * camino "falta aplicar" que el dryRun promete mostrar era INALCANZABLE en main. En dev no
     * se notaba si la columna ya estaba, que es cómo esto habría llegado a producción.
     */
    const [c] = existe
      ? await sql`
          SELECT COUNT(*)::int AS filas,
                 COUNT(ascii_nombre)::int AS con_ascii,
                 COUNT(*) FILTER (WHERE clave ~ '[^ -~]')::int AS no_ascii,
                 COUNT(*) FILTER (WHERE clave = '')::int AS vacias
          FROM cities`
      : await sql`
          SELECT COUNT(*)::int AS filas, 0 AS con_ascii,
                 COUNT(*) FILTER (WHERE clave ~ '[^ -~]')::int AS no_ascii,
                 COUNT(*) FILTER (WHERE clave = '')::int AS vacias
          FROM cities`;

    /**
     * LA HUELLA DE TODAS LAS CLAVES. Es lo que convierte "correrla antes de la recarga no
     * cambia ninguna clave" de una lectura de la expresión en una medición: se toma antes y
     * después del SET EXPRESSION y tienen que ser idénticas. Un conteo igual de no-ASCII NO
     * alcanzaría — dos claves podrían haberse intercambiado sin mover el total.
     */
    const [h] = await sql`
      SELECT md5(string_agg(geonames_id::text || ':' || clave, ',' ORDER BY geonames_id)) AS h
      FROM cities`;

    const descolgadas: Record<string, number> = {};
    const conCityId: Record<string, number> = {};
    const ejemplos: string[] = [];
    for (const { tabla, pk } of CON_CITY_ID) {
      const [n] = await sql(`SELECT COUNT(*)::int AS n FROM ${tabla} WHERE city_id IS NOT NULL`);
      conCityId[tabla] = n.n as number;
      const filas = await sql(`
        SELECT t.${pk}::text AS fila, t.city, t.country_code AS pais_fila,
               c.clave, c.country_code AS pais_ciudad, c.nombre
        FROM ${tabla} t JOIN cities c ON c.geonames_id = t.city_id
        WHERE t.city_id IS NOT NULL
        ORDER BY t.${pk}
        LIMIT ${TOPE_A_REVISAR}`);
      let malas = 0;
      for (const f of filas) {
        const textoNormalizado = normalizarNombre(String(f.city ?? ""));
        if (f.pais_ciudad !== f.pais_fila || f.clave !== textoNormalizado) {
          malas++;
          if (ejemplos.length < 20) {
            ejemplos.push(
              `${tabla}/${f.fila}: texto ${JSON.stringify(f.city)} [${f.pais_fila}] -> ` +
                `${JSON.stringify(f.nombre)} [${f.pais_ciudad}], clave ${JSON.stringify(f.clave)} ` +
                `contra ${JSON.stringify(textoNormalizado)}`
            );
          }
        }
      }
      descolgadas[tabla] = malas;
      if (filas.length === TOPE_A_REVISAR) {
        ejemplos.push(`${tabla}: se revisaron las primeras ${TOPE_A_REVISAR} y puede haber más.`);
      }
    }
    return {
      columnaExiste: Boolean(existe),
      filas: c.filas as number,
      conAsciiNombre: c.con_ascii as number,
      clavesNoAscii: c.no_ascii as number,
      clavesVacias: c.vacias as number,
      huellaDeClaves: (h.h as string | null) ?? "",
      descolgadas,
      conCityId,
      ejemplos,
    };
  };

  const contarDescolgadas = (m: Medicion) =>
    Object.values(m.descolgadas).reduce((a, b) => a + b, 0);

  try {
    const [hay] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'cities'`;
    if (!hay) {
      return NextResponse.json(
        { ok: false, error: "Falta la tabla cities. Corré /api/setup-cities primero." },
        { status: 409 }
      );
    }

    const antes = await medir();
    const formaAntes = await leerForma();
    /**
     * LA GUARDA ES LA IGUALDAD COMPLETA, NO "MENCIONA ascii_nombre".
     *
     * Era un `includes("ascii_nombre")` y la revisión mostró el agujero: cualquier expresión
     * que nombre la columna —una COALESCE a mano sin el NULLIF, una a medias de un intento
     * anterior— activaba la guarda, se salteaba el SET EXPRESSION, y la migración devolvía
     * ok:true informando el problema sin arreglarlo. Había que ir a corregirlo a mano.
     *
     * Con la igualdad, toda expresión que no sea EXACTAMENTE la esperada se reescribe. El
     * costo conocido: si Neon sube de versión mayor y cambia cómo RINDE la expresión, esto
     * reescribiría la tabla una vez de más. Reescribir una vez de más es barato; dejar una
     * expresión equivocada puesta no lo es.
     */
    const yaEstaba = formaAntes.claveExpresion === EXPRESION_ESPERADA;

    if (dryRun) {
      const problemas = verificarForma(formaAntes);
      log.push(
        `SIMULACIÓN. cities tiene ${antes.filas} fila(s), ${antes.clavesNoAscii} claves con ` +
          `algún carácter no-ASCII y ${antes.clavesVacias} vacías. ` +
          (antes.columnaExiste
            ? `ascii_nombre existe, con ${antes.conAsciiNombre} fila(s) llena(s).`
            : "ascii_nombre TODAVÍA NO EXISTE.")
      );
      log.push(
        yaEstaba
          ? "La expresión de clave YA sale de ascii_nombre: esta migración está aplicada."
          : "Se agregaría cities.ascii_nombre TEXT nullable y clave pasaría a derivarse de " +
              "COALESCE(NULLIF(btrim(ascii_nombre),''), nombre) con SET EXPRESSION, que " +
              "reescribe la tabla y reconstruye los dos índices."
      );
      /**
       * Ver estadoDeRecarga(): son TRES estados y acá había dos.
       */
      log.push(
        estadoDeRecarga({
          expresionAplicada: yaEstaba,
          conAsciiNombre: antes.conAsciiNombre,
          filas: antes.filas,
        }).mensaje
      );
      for (const { tabla } of CON_CITY_ID) {
        log.push(
          `  ${tabla}: ${antes.conCityId[tabla]} fila(s) con city_id, ` +
            `${antes.descolgadas[tabla]} descolgada(s) de la clave de su propio texto.`
        );
      }
      log.push(
        contarDescolgadas(antes) === 0
          ? "Ninguna fila perdió su ciudad. Ese es el número que hay que volver a mirar DESPUÉS " +
              "de la recarga, con este mismo dryRun."
          : `ATENCIÓN: ${contarDescolgadas(antes)} fila(s) están descolgadas.`
      );
      for (const x of antes.ejemplos) log.push(`    ${x}`);
      if (!yaEstaba && antes.conAsciiNombre > 0) {
        log.push(
          `SE VA A NEGAR CON 409: ascii_nombre ya tiene ${antes.conAsciiNombre} fila(s) con dato ` +
            "y la expresión todavía es la vieja, así que reexpresar movería esas claves de golpe."
        );
      }
      log.push(
        problemas.length === 0
          ? "Ya está aplicada y verificada."
          : `Falta aplicar: ${problemas.length} problema(s).`
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
     * EL SET EXPRESSION SE SALTEA SI YA ESTÁ PUESTO, y no por prolijidad: reescribe 171.174
     * filas y reconstruye dos índices. Correr la migración dos veces —que es la regla del
     * repo— no tiene por qué pagar eso dos veces.
     *
     * La guarda es "la expresión menciona ascii_nombre", que es una comprobación de presencia
     * y alcanza para DECIDIR. Lo que NO alcanza es para afirmar: la verificación de abajo
     * compara la expresión COMPLETA contra la medida, y es la que manda.
     */
    /**
     * Y SI LA COLUMNA YA TIENE DATOS CON LA EXPRESIÓN VIEJA, SE NIEGA.
     *
     * Es el caso que la revisión marcó y que rompe la promesa central de esta migración.
     * "Correrla antes de la recarga no cambia ninguna clave" vale PORQUE ascii_nombre está en
     * NULL en todas las filas. Si alguien la agregó a mano y la llenó —una carga parcial, una
     * prueba— el SET EXPRESSION movería miles de claves de golpe, sin que nadie hubiera pedido
     * eso en este paso, y el emparejamiento del backfill cambiaría abajo del código.
     *
     * 409 y no un arreglo automático: mover claves es una decisión, y quien llenó esa columna
     * tiene que decir qué quiere que pase.
     */
    if (!yaEstaba && antes.conAsciiNombre > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `cities.ascii_nombre ya tiene ${antes.conAsciiNombre} fila(s) con dato y la ` +
            "expresión de clave todavía es la vieja. Reexpresar ahora movería esas claves de " +
            "golpe. Esto no debería poder pasar: la columna la crea esta migración y la llena " +
            "el cargador DESPUÉS. Mirá quién la llenó antes de seguir.",
          antes,
        },
        { status: 409 }
      );
    }

    if (yaEstaba) {
      log.push("La expresión de clave ya es la esperada: no se reescribe la tabla.");
      await sql`ALTER TABLE cities ADD COLUMN IF NOT EXISTS ascii_nombre TEXT`;
    } else {
      /**
       * Las dos van en UNA transacción. No es el swap peligroso de DROP+ADD —SET EXPRESSION no
       * deja ninguna ventana sin índice— pero si el SET fallara después de un ADD suelto
       * quedaría una columna que nadie usa, y la regla del repo es que o entran las dos o
       * ninguna.
       */
      await sql.transaction([
        sql`ALTER TABLE cities ADD COLUMN IF NOT EXISTS ascii_nombre TEXT`,
        sql(`ALTER TABLE cities ALTER COLUMN clave SET EXPRESSION AS (${normalizarEnSql(FUENTE_DE_CLAVE)})`),
      ]);
      log.push("ascii_nombre agregada y clave reexpresada. La tabla se reescribió una vez.");
    }

    const formaDespues = await leerForma();
    const despues = await medir();
    const problemas = verificarForma(formaDespues);

    /**
     * Y LA PREGUNTA DEL USUARIO, CONTESTADA CON UN NÚMERO: ninguna fila con city_id puede
     * haber quedado descolgada de la clave de su propio texto.
     */
    for (const { tabla } of CON_CITY_ID) {
      if (despues.descolgadas[tabla] > 0) {
        problemas.push(
          `${tabla}: ${despues.descolgadas[tabla]} fila(s) con city_id quedaron descolgadas de ` +
            "la clave de su propio texto. Cambiar clave les movió el emparejamiento."
        );
      }
    }
    /**
     * Y LA PROMESA CENTRAL, MEDIDA: ninguna clave se movió. No se lee de la expresión, se
     * compara el md5 de las 171.174 filas antes y después. Un conteo igual de no-ASCII no
     * alcanzaría: dos claves podrían haberse intercambiado dejando el total intacto.
     */
    if (despues.huellaDeClaves !== antes.huellaDeClaves) {
      problemas.push(
        "ALGUNA CLAVE SE MOVIÓ al reexpresar. Con ascii_nombre en NULL en todas las filas el " +
          "COALESCE cae al nombre local y las claves tenían que quedar idénticas."
      );
    }
    if (despues.clavesVacias > antes.clavesVacias) {
      problemas.push(
        `aparecieron ${despues.clavesVacias - antes.clavesVacias} clave(s) VACÍAS, que son ` +
          "ciudades que ya no se pueden buscar."
      );
    }

    log.push(
      `cities: ${despues.filas} fila(s), ${despues.conAsciiNombre} con ascii_nombre, ` +
        `${despues.clavesNoAscii} claves no-ASCII (de ${antes.clavesNoAscii} antes).`
    );
    for (const { tabla } of CON_CITY_ID) {
      log.push(
        `  ${tabla}: ${despues.conCityId[tabla]} con city_id, ${despues.descolgadas[tabla]} descolgada(s).`
      );
    }
    for (const x of despues.ejemplos) log.push(`    ${x}`);
    log.push(
      problemas.length === 0
        ? "VERIFICADO: ascii_nombre es TEXT nullable sin default, clave es GENERATED ALWAYS con " +
            "la expresión exacta esperada, los dos índices quedaron con su definición completa, " +
            "y ninguna fila con city_id perdió su ciudad."
        : `NO VERIFICADO: ${problemas.length} problema(s).`
    );
    for (const x of problemas) log.push(`  - ${x}`);
    /**
     * Y ACÁ LA MISMA FUNCIÓN, por el mismo motivo. Esta línea decía "SIGUIENTE PASO: correr el
     * cargador" SIEMPRE, así que después de la recarga la corrida real seguía mandando a
     * recargar. Menos grave que el otro caso —no afirma un hecho falso, da una instrucción de
     * más— pero es la misma causa y se arregla en el mismo lugar.
     */
    log.push(
      estadoDeRecarga({
        expresionAplicada: true,
        conAsciiNombre: despues.conAsciiNombre,
        filas: despues.filas,
      }).mensaje
    );

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: problemas.length === 0,
      problemas,
      antes,
      despues,
      log,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
