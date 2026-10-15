/**
 * MIGRATION — una clave para el nombre en español, para que el autocompletado no recorra el país.
 *
 *   /api/setup-cities-clave-es?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-cities-clave-es?secret=YOUR_SECRET
 *
 * ============================================================
 * EL PROBLEMA, MEDIDO
 * ============================================================
 *
 * La búsqueda del selector es `clave LIKE $2 OR normalizar(nombre_es) LIKE $2`. La primera
 * rama usa cities_pais_clave_idx; la segunda no tiene índice porque normaliza al vuelo. Así
 * que Postgres abandona el índice de clave y recorre EL PAÍS ENTERO filtrando:
 *
 *   USA "new"   Bitmap Heap Scan   descarta 17.096 de las 17.343 filas del país   18,9 ms
 *   IND "kol"   Bitmap Heap Scan   descarta  7.092 de las  7.113                   2,2 ms
 *   IND "mum"   Bitmap Heap Scan   descarta  7.112 de las  7.113                   2,2 ms
 *
 * Funciona y es rápido con los países que hay hoy, y no escala: eso pasa en CADA TECLA de cada
 * persona que escribe una ciudad. Con un país grande y varias personas a la vez, es la tabla
 * entera leída muchas veces por minuto para devolver ocho filas.
 *
 * ============================================================
 * LA COLUMNA GENERADA, Y POR QUÉ NO ALCANZA UN ÍNDICE DE EXPRESIÓN
 * ============================================================
 *
 * Se podría indexar la expresión —CREATE INDEX ... ON cities (country_code,
 * normalizar(nombre_es))— y Postgres la usaría. Pero entonces la definición del normalizador
 * queda escrita DENTRO de un índice, y cualquier cambio en normalizarEnSql dejaría el índice
 * silenciosamente desalineado con lo que la consulta calcula: el índice no se usaría y nadie
 * se enteraría, porque los resultados seguirían siendo correctos.
 *
 * Una columna GENERATED ALWAYS tiene la expresión en un solo lugar, el mismo que ya usa clave,
 * y Postgres garantiza que el valor no puede divergir del dato. Es la forma que ya está en la
 * tabla, así que no introduce un patrón nuevo.
 *
 * ============================================================
 * EL ÍNDICE ES PARCIAL, Y ESO HAY QUE MEDIRLO, NO SUPONERLO
 * ============================================================
 *
 * nombre_es está en 21.860 de 171.174 filas —el 12,8%— así que clave_es es NULL en el 87,2%.
 * Un índice parcial WHERE clave_es IS NOT NULL es unas ocho veces más chico.
 *
 * El riesgo es que Postgres no pruebe que la consulta implica el predicado del índice y lo
 * ignore EN SILENCIO: la consulta seguiría dando los mismos resultados, nada más que lenta.
 * Por eso la consulta lleva `clave_es IS NOT NULL` explícito —no para corregir, que el LIKE
 * ya lo implica, sino para que la implicación sea trivial de probar— y por eso la batería
 * exige que el plan NOMBRE este índice.
 *
 * ============================================================
 * EL RESIDUO DE 216 FILAS, MEDIDO, Y POR QUÉ NO CUESTA NADA
 * ============================================================
 *
 * clave_es se normaliza con normalizarEnSql, que es la misma función con el mismo límite que
 * acabamos de arreglar en clave con el asciiname de GeoNames: 216 de los 21.860 nombres en
 * español quedan con un diacrítico que no sabe sacar —"Kōbe", "Chișinău", "Almatý"—. Y para
 * nombre_es NO hay un asciiname: GeoNames no publica una versión ASCII del nombre español.
 *
 * Y NO IMPORTA, lo cual está medido y no razonado: las 216 tienen su `clave` en ASCII limpio
 * —216 de 216, cero excepciones— porque esa sale del asciiname del nombre local. O sea que
 * tipear "kobe" encuentra Kōbe por la PRIMERA rama, y "chisinau" encuentra Chișinău igual.
 *
 * Lo que clave_es agrega es el caso en que el nombre español es OTRA PALABRA: London/Londres,
 * New York City/Nueva York. Eso son 2.894 filas, y de esas las 216 son justamente aquellas
 * cuyo "nombre español" es el nombre local con tildes, o sea las que menos lo necesitan.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { normalizarEnSql } from "@/lib/convocatorias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** ADD COLUMN de una columna generada reescribe las 171.174 filas y después indexa 21.860. */
export const maxDuration = 60;

const COLUMNA = "clave_es";
const INDICE = "cities_pais_clave_es_idx";

/**
 * LA DEFINICIÓN RENDERIZADA que Postgres guarda, derivada de la que ya tenía clave antes del
 * asciiname —medida contra la base— cambiando nombre por nombre_es. La verificación la compara
 * entera, y si Postgres rinde algo distinto lo dice en vez de darlo por bueno.
 */
const EXPRESION_ESPERADA =
  "btrim(regexp_replace(lower(translate(translate(nombre_es, (((((chr(768) || chr(769)) || chr(770)) || chr(771)) || chr(776)) || chr(807)), ''::text), 'áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜãõÃÕñÑçÇ'::text, 'aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUaoAOnNcC'::text)), (('[[:space:]'::text || chr(160)) || ']+'::text), ' '::text, 'g'::text), ' '::text)";

const INDICE_ESPERADO =
  `CREATE INDEX ${INDICE} ON public.cities USING btree (country_code, ${COLUMNA}) ` +
  `WHERE (${COLUMNA} IS NOT NULL)`;

type Forma = {
  existe: boolean;
  generada: boolean;
  expresion: string | null;
  aceptaNull: boolean;
  indices: string[];
};

function verificar(f: Forma): string[] {
  const p: string[] = [];
  if (!f.existe) {
    p.push(`falta cities.${COLUMNA}`);
  } else {
    if (!f.generada) p.push(`cities.${COLUMNA} existe pero NO es GENERATED ALWAYS`);
    /**
     * NULLABLE, y verificado como tal: nombre_es es NULL en el 87,2% de las filas, así que una
     * clave_es NOT NULL no podría existir. Si apareciera, alguien le puso un COALESCE y la
     * columna dejó de significar "esta ciudad tiene nombre en español".
     */
    if (!f.aceptaNull) p.push(`cities.${COLUMNA} es NOT NULL y tiene que ser nullable`);
    if (f.expresion !== EXPRESION_ESPERADA) {
      p.push(
        `la expresión de cities.${COLUMNA} NO es la esperada.\n      es:      ${f.expresion}` +
          `\n      debería: ${EXPRESION_ESPERADA}`
      );
    }
  }
  const linea = f.indices.find((x) => x.startsWith(`${INDICE}: `));
  if (!linea) p.push(`falta el índice ${INDICE}`);
  else if (linea.slice(INDICE.length + 2) !== INDICE_ESPERADO) {
    p.push(
      `el índice ${INDICE} tiene otra definición.\n      es:      ${linea.slice(INDICE.length + 2)}` +
        `\n      debería: ${INDICE_ESPERADO}`
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
      SELECT is_nullable, is_generated, generation_expression FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = ${COLUMNA}`;
    const idx = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'cities' ORDER BY indexname`;
    return {
      existe: cols.length > 0,
      generada: cols[0]?.is_generated === "ALWAYS",
      expresion: (cols[0]?.generation_expression as string | null) ?? null,
      aceptaNull: cols[0]?.is_nullable === "YES",
      indices: idx.map((x) => `${x.indexname}: ${x.indexdef}`),
    };
  };

  /**
   * Lo que importa de los datos: cuántas filas van a poder buscarse por su nombre español, y
   * cuántas quedan con el residuo. Las dos cifras se loguean para que el número del comentario
   * de arriba se pueda comprobar en vez de creer.
   */
  const medir = async () => {
    const existe = (await leerForma()).existe;
    const expr = existe ? COLUMNA : normalizarEnSql("nombre_es");
    const [r] = await sql(`
      SELECT COUNT(*)::int AS filas,
             COUNT(nombre_es)::int AS con_es,
             COUNT(*) FILTER (WHERE nombre_es IS NOT NULL AND ${expr} ~ '[^ -~]')::int AS residuo,
             COUNT(*) FILTER (WHERE nombre_es IS NOT NULL AND ${expr} <> clave)::int AS difieren,
             COUNT(*) FILTER (WHERE nombre_es IS NOT NULL AND ${expr} = '')::int AS vacias
      FROM cities`);
    return {
      filas: r.filas as number,
      conNombreEs: r.con_es as number,
      residuoNoAscii: r.residuo as number,
      difierenDelLocal: r.difieren as number,
      clavesEsVacias: r.vacias as number,
    };
  };

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

    /**
     * Y QUE LA TABLA ESTÉ CARGADA. Con cities vacía la migración andaría —crea la columna y el
     * índice igual— pero el log diría "0 filas con nombre en español" y eso se lee como un
     * defecto de GeoNames en vez de como una tabla sin cargar.
     */
    const antes = await medir();
    if (antes.filas === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "cities está VACÍA. La columna y el índice se crearían igual, pero no habría nada " +
            "que medir. Cargala con scripts/cargar-ciudades.mjs primero.",
        },
        { status: 409 }
      );
    }

    const formaAntes = await leerForma();

    if (dryRun) {
      const problemas = verificar(formaAntes);
      log.push(
        `SIMULACIÓN. cities tiene ${antes.filas} fila(s), ${antes.conNombreEs} con nombre en ` +
          `español (${((100 * antes.conNombreEs) / antes.filas).toFixed(1)}%).`
      );
      log.push(
        formaAntes.existe
          ? `cities.${COLUMNA} ya existe.`
          : `Se agregaría cities.${COLUMNA} GENERATED ALWAYS desde nombre_es, y el índice ` +
              `PARCIAL ${INDICE} sobre (country_code, ${COLUMNA}) WHERE ${COLUMNA} IS NOT NULL ` +
              `— unas ${antes.conNombreEs} entradas en vez de ${antes.filas}.`
      );
      log.push(
        `De las ${antes.conNombreEs}, ${antes.difierenDelLocal} tienen un nombre español ` +
          `DISTINTO de la clave local: esas son las que esta columna hace alcanzables.`
      );
      log.push(
        `Residuo: ${antes.residuoNoAscii} clave(s) quedarían con un diacrítico que ` +
          "normalizarEnSql no saca. No cuesta alcance: esas ciudades se encuentran por su " +
          "nombre local, que sí es ASCII. Está medido en la batería."
      );
      log.push(
        `Claves en español vacías: ${antes.clavesEsVacias}. Tiene que ser 0.`
      );
      log.push(
        problemas.length === 0 ? "Ya está aplicada y verificada." : `Falta aplicar: ${problemas.length} problema(s).`
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
     * Las dos en una transacción: una columna generada sin su índice no sirve de nada, y el
     * índice sin la columna no se puede crear. Si el CREATE INDEX falla, la columna tampoco
     * queda — que es lo que hace que una segunda corrida arranque de un estado conocido en vez
     * de uno a medias.
     *
     * El índice va con DROP IF EXISTS antes del CREATE, por lo mismo que los swaps de
     * constraint: si existiera uno con ese nombre y otra definición, un CREATE INDEX
     * IF NOT EXISTS lo dejaría como está y la migración devolvería ok con la forma equivocada.
     */
    await sql.transaction([
      sql(
        `ALTER TABLE cities ADD COLUMN IF NOT EXISTS ${COLUMNA} TEXT ` +
          `GENERATED ALWAYS AS (${normalizarEnSql("nombre_es")}) STORED`
      ),
      sql(`DROP INDEX IF EXISTS ${INDICE}`),
      sql(INDICE_ESPERADO),
    ]);
    log.push(
      `cities.${COLUMNA} agregada y ${INDICE} creado. La tabla se reescribió una vez.`
    );

    const despues = await medir();
    const problemas = verificar(await leerForma());

    if (despues.filas !== antes.filas) {
      problemas.push(
        `cities tenía ${antes.filas} fila(s) y ahora tiene ${despues.filas}. Esta migración no ` +
          "inserta ni borra ninguna."
      );
    }
    if (despues.clavesEsVacias > 0) {
      problemas.push(
        `${despues.clavesEsVacias} fila(s) con nombre en español quedaron con ${COLUMNA} vacía, ` +
          "así que no se pueden buscar por ese nombre."
      );
    }
    /**
     * Y QUE LA COLUMNA DIGA LO MISMO QUE LA EXPRESIÓN AL VUELO. Es la comprobación que hace que
     * "GENERATED garantiza que no divergen" sea una medición: se compara la columna contra el
     * normalizador aplicado en el momento, fila por fila.
     */
    const [discrepan] = await sql(`
      SELECT COUNT(*)::int AS n FROM cities
      WHERE nombre_es IS NOT NULL
        AND ${COLUMNA} IS DISTINCT FROM ${normalizarEnSql("nombre_es")}`);
    if (discrepan.n > 0) {
      problemas.push(
        `${discrepan.n} fila(s) donde ${COLUMNA} no coincide con normalizar(nombre_es) calculado ` +
          "al vuelo. La columna generada no está haciendo lo que dice."
      );
    }

    log.push(
      `cities: ${despues.filas} fila(s), ${despues.conNombreEs} con nombre en español, ` +
        `${despues.difierenDelLocal} con un nombre español distinto del local, ` +
        `${despues.residuoNoAscii} de residuo, ${despues.clavesEsVacias} vacías.`
    );
    log.push(
      problemas.length === 0
        ? `VERIFICADO: cities.${COLUMNA} es GENERATED ALWAYS nullable con la expresión exacta ` +
            `esperada, ${INDICE} quedó con su definición completa —parcial incluida— y la ` +
            "columna coincide fila por fila con el normalizador aplicado al vuelo."
        : `NO VERIFICADO: ${problemas.length} problema(s).`
    );
    for (const x of problemas) log.push(`  - ${x}`);
    log.push(
      "SIGUIENTE PASO: desplegar la búsqueda en UNION. Hasta entonces el selector sigue usando " +
        "el OR y recorriendo el país — la columna y el índice no hacen nada solos."
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
