/**
 * MIGRATION — edit_log aprende a registrar ediciones de un ARTISTA y de un TOQUE.
 *
 *   /api/setup-edit-log-artista?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-edit-log-artista?secret=YOUR_SECRET
 *
 * ============================================================
 * POR QUÉ HACE FALTA
 * ============================================================
 *
 * El panel de moderación va a tener una lista de filas con ciudad en texto libre —city_id en
 * NULL y city no vacía— para asignarles la ciudad a mano, y esa asignación tiene que quedar
 * registrada con su autor, igual que cualquier otra edición.
 *
 * Y ahí edit_log no da. Medido contra la base:
 *
 *   collective_slug   NOT NULL, con CHECK de no-vacío
 *   entidad           CHECK con SIETE valores: collective, event, news, set, track,
 *                     genero, imagen
 *
 * Asignarle la ciudad a un ARTISTA no tiene colectivo y no tiene valor de entidad. A un TOQUE
 * declarado, tampoco: artist_gigs es contenido del perfil del DJ.
 *
 * ============================================================
 * NULLABLE CON UN CHECK QUE ATA EN LOS DOS SENTIDOS, NO UN SLUG CENTINELA
 * ============================================================
 *
 * La alternativa era meter un slug inventado —'hotu', '—', lo que sea— y dejar el NOT NULL en
 * pie. Es peor: afirma que existe un colectivo que no existe, y collective_slug NO TIENE FK
 * —edit_log no tiene ninguno, a propósito, porque tiene que sobrevivir a lo que registra— así
 * que nada lo atajaría. A los seis meses alguien agrupa por collective_slug y le aparece un
 * colectivo fantasma con ediciones.
 *
 * Y nullable PELADO también es peor, porque aflojaría la guarda para los siete valores que ya
 * existen: una edición de un colectivo podría entrar sin decir de qué colectivo. Permitir NULL
 * no alcanza; hay que IMPEDIR los estados intermedios, que es el mismo criterio que el CHECK
 * de mail_outbox con purgado_en.
 *
 * Así que el CHECK ata las dos mitades:
 *
 *   entidad en ('artista','toque')  ->  collective_slug TIENE que ser NULL
 *   cualquiera de los otros siete   ->  TIENE que estar, y no vacío
 *
 * ============================================================
 * LAS DEFENSAS DE NULL DE CADA RAMA, QUE ES DONDE ESTO SE ESCRIBE MAL
 * ============================================================
 *
 * UN CHECK QUE EVALÚA A NULL PASA. Ya pasó dos veces en este repo con los CHECK de
 * convocatorias, así que cada rama del OR lleva su propia defensa y está razonado acá:
 *
 *   entidad es NOT NULL, así que `entidad = ANY(...)` nunca da NULL.
 *   `collective_slug IS NULL` y `IS NOT NULL` nunca dan NULL por definición.
 *   `btrim(collective_slug, ...) <> ''` SÍ da NULL cuando la columna es NULL — pero está
 *   detrás de un `collective_slug IS NOT NULL` en el mismo AND, y en SQL un FALSE en un AND
 *   gana sobre un NULL. Así que la rama entera da FALSE, no NULL.
 *
 * Verificado a mano sobre los cuatro casos, y MEDIDO con INSERT de verdad en
 * scripts/pruebas/edit-log-artista.mjs — porque comparar la definición renderizada prueba la
 * forma, no que el CHECK rechace lo que tiene que rechazar.
 *
 *   entidad='event',   slug='x'    -> FALSE OR TRUE  = pasa
 *   entidad='event',   slug=NULL   -> FALSE OR FALSE = rechaza
 *   entidad='event',   slug='  '   -> FALSE OR FALSE = rechaza
 *   entidad='artista', slug=NULL   -> TRUE  OR FALSE = pasa
 *   entidad='artista', slug='x'    -> FALSE OR FALSE = rechaza
 *
 * ============================================================
 * LOS DOS SWAP VAN EN UNA TRANSACCIÓN, Y EL ADD VA DESNUDO
 * ============================================================
 *
 * Entre un DROP CONSTRAINT y su ADD hay una ventana real de un round-trip —cada sql del
 * driver HTTP de Neon es su propio request— en la que la tabla no tiene guarda. Y si el ADD
 * falla, la ventana no se cierra nunca.
 *
 * Adentro de la transacción el ADD va SIN el envoltorio DO $$ EXCEPTION WHEN duplicate_object:
 * después del DROP no queda nada con ese nombre que duplicar, así que ese handler sólo podría
 * tragarse un error real — por ejemplo un check_violation de una fila vieja que el CHECK nuevo
 * no acepta, que NO es duplicate_object y por lo tanto tampoco atraparía.
 *
 * El DROP NOT NULL entra en la misma transacción: un collective_slug nullable con el CHECK
 * viejo todavía puesto no tiene sentido, y al revés tampoco.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "edit_log";

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** Las dos entidades que NO pertenecen a un colectivo. */
const SIN_COLECTIVO = ["artista", "toque"];

/** Los siete que ya existían, que sí lo exigen. */
const CON_COLECTIVO = ["collective", "event", "news", "set", "track", "genero", "imagen"];

const TODAS = [...CON_COLECTIVO, ...SIN_COLECTIVO];

const comoArray = (xs: string[]) => `ARRAY[${xs.map((x) => `'${x}'::text`).join(", ")}]`;

/**
 * LO QUE SE ESCRIBE. La definición renderizada que Postgres va a guardar NO es esto —reordena
 * paréntesis y agrega ::text— así que se mide después de aplicar y se compara contra lo medido.
 */
const ENTIDAD_CHECK = `CHECK ((entidad = ANY (${comoArray(TODAS)})))`;

const COLECTIVO_CHECK =
  "CHECK (" +
  `((entidad = ANY (${comoArray(SIN_COLECTIVO)})) AND (collective_slug IS NULL))` +
  " OR " +
  `((entidad <> ALL (${comoArray(SIN_COLECTIVO)})) AND (collective_slug IS NOT NULL)` +
  ` AND (btrim(collective_slug, '${BLANCOS}'::text) <> ''::text))` +
  ")";

/**
 * LAS DEFINICIONES RENDERIZADAS ESPERADAS, medidas contra la base después de aplicar.
 * Arrancan vacías y se llenan con el valor medido; mientras estén vacías la verificación
 * dice que no puede verificar, que es lo honesto, en vez de dar por buena cualquier forma.
 */
const RENDER_ESPERADO: Record<string, string> = {
  [`${TABLA}_entidad_check`]: `CHECK ((entidad = ANY (${comoArray(TODAS)})))`,
  /**
   * SE ARMA CON LAS MISMAS CONSTANTES, NO SE TRANSCRIBE.
   *
   * La definición que Postgres rinde lleva adentro el conjunto de blancos, y ahí hay un
   * espacio duro U+00A0. Copiar el valor medido a mano metería ese invisible LITERAL en el
   * fuente — exactamente la bomba de tiempo que AGENTS.md prohíbe, y que ya se plantó tres
   * veces en este repo. Armarlo desde BLANCOS deja el escape donde estaba y además hace que
   * cambiar el conjunto en un solo lugar mueva las dos puntas a la vez.
   *
   * Lo que NO se puede derivar es el ORDEN de los paréntesis y los ::text que Postgres
   * agrega: eso está medido contra la base, y la batería vuelve a comprobar la igualdad.
   */
  [`${TABLA}_colectivo_check`]:
    "CHECK ((" +
    `((entidad = ANY (${comoArray(SIN_COLECTIVO)})) AND (collective_slug IS NULL))` +
    " OR " +
    `((entidad <> ALL (${comoArray(SIN_COLECTIVO)})) AND (collective_slug IS NOT NULL)` +
    ` AND (btrim(collective_slug, '${BLANCOS}'::text) <> ''::text))` +
    "))",
};

type Forma = {
  slugAceptaNull: boolean | null;
  checks: Record<string, string>;
};

function verificar(f: Forma): string[] {
  const p: string[] = [];
  if (f.slugAceptaNull === null) p.push(`falta ${TABLA}.collective_slug`);
  else if (!f.slugAceptaNull) {
    p.push(`${TABLA}.collective_slug sigue siendo NOT NULL`);
  }
  for (const [nombre, esperado] of Object.entries(RENDER_ESPERADO)) {
    const real = f.checks[nombre];
    if (!real) {
      p.push(`falta el CHECK ${nombre}`);
      continue;
    }
    if (!esperado) {
      p.push(
        `no tengo medida la definición esperada de ${nombre}, así que NO puedo verificarla.\n` +
          `      la que quedó es: ${real}`
      );
      continue;
    }
    if (real !== esperado) {
      p.push(
        `el CHECK ${nombre} tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
      );
    }
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
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${TABLA} AND column_name = 'collective_slug'`;
    const cons = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = ${TABLA}::regclass AND contype = 'c' ORDER BY conname`;
    return {
      slugAceptaNull: cols.length === 0 ? null : cols[0].is_nullable === "YES",
      checks: Object.fromEntries(cons.map((c) => [c.conname as string, c.def as string])),
    };
  };

  /** Cuántas filas hay y cómo se reparten, que es lo que un swap de CHECK puede romper. */
  const medir = async () => {
    const [n] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
    const porEntidad = await sql(`
      SELECT entidad, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE collective_slug IS NULL)::int AS sin_slug
      FROM ${TABLA} GROUP BY 1 ORDER BY 2 DESC`);
    return {
      filas: n.n as number,
      porEntidad: porEntidad.map((r) => ({
        entidad: r.entidad as string,
        filas: r.n as number,
        sinSlug: r.sin_slug as number,
      })),
    };
  };

  try {
    const [hay] = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${TABLA}`;
    if (!hay) {
      return NextResponse.json(
        { ok: false, error: `Falta la tabla ${TABLA}.` },
        { status: 409 }
      );
    }

    const antes = await medir();
    const formaAntes = await leerForma();

    /**
     * Y QUE NINGUNA FILA VIEJA VIOLE EL CHECK NUEVO, comprobado ANTES de dropear nada.
     *
     * Es el modo de falla que el envoltorio duplicate_object no atrapa: una fila con una
     * entidad de los siete y el slug en NULL haría fallar el ADD, y la transacción abortaría
     * dejando la tabla como estaba — pero con un error crudo de Postgres en vez de un mensaje
     * que diga qué fila. Hoy no puede haber ninguna, porque la columna es NOT NULL; queda
     * medido igual, porque "no puede haber" es una afirmación sobre un estado que esta misma
     * migración está por cambiar.
     */
    const [conflictivas] = await sql(`
      SELECT COUNT(*)::int AS n FROM ${TABLA}
      WHERE NOT (
        ((entidad = ANY (${comoArray(SIN_COLECTIVO)})) AND (collective_slug IS NULL))
        OR ((entidad <> ALL (${comoArray(SIN_COLECTIVO)})) AND (collective_slug IS NOT NULL)
            AND (btrim(collective_slug, '${BLANCOS}'::text) <> ''::text))
      )`);
    const [entidadRara] = await sql(`
      SELECT COUNT(*)::int AS n FROM ${TABLA} WHERE entidad <> ALL (${comoArray(TODAS)})`);

    const yaEstaba =
      formaAntes.slugAceptaNull === true &&
      (formaAntes.checks[`${TABLA}_entidad_check`] ?? "").includes("'artista'");

    if (dryRun) {
      const problemas = verificar(formaAntes);
      log.push(
        `SIMULACIÓN. ${TABLA} tiene ${antes.filas} fila(s). collective_slug ` +
          `${formaAntes.slugAceptaNull ? "YA acepta" : "NO acepta"} NULL.`
      );
      for (const e of antes.porEntidad) {
        log.push(`  ${e.entidad}: ${e.filas} fila(s), ${e.sinSlug} sin collective_slug`);
      }
      log.push(
        yaEstaba
          ? "Ya está aplicada: entidad acepta 'artista' y collective_slug es nullable."
          : `Se haría: collective_slug DROP NOT NULL, y swap de ${TABLA}_entidad_check (gana ` +
              `'artista' y 'toque') y de ${TABLA}_colectivo_check (pasa a atar las dos mitades), ` +
              "los tres en UNA transacción."
      );
      log.push(
        `Filas que el CHECK nuevo rechazaría: ${conflictivas.n}. ` +
          (conflictivas.n === 0
            ? "Ninguna, así que el ADD no puede fallar por datos."
            : "HAY QUE MIRARLAS: el ADD fallaría y la transacción abortaría.")
      );
      log.push(
        `Filas con una entidad que ni el CHECK viejo ni el nuevo nombran: ${entidadRara.n}.`
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
        conflictivas: conflictivas.n,
        antes,
        log,
      });
    }

    if (conflictivas.n > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `${conflictivas.n} fila(s) de ${TABLA} violarían el CHECK nuevo, así que el ADD ` +
            "fallaría y la transacción abortaría. Mirá esas filas antes de correr esto.",
          antes,
        },
        { status: 409 }
      );
    }

    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ALTER COLUMN collective_slug DROP NOT NULL`),
      sql(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${TABLA}_entidad_check`),
      sql(`ALTER TABLE ${TABLA} ADD CONSTRAINT ${TABLA}_entidad_check ${ENTIDAD_CHECK}`),
      sql(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${TABLA}_colectivo_check`),
      sql(`ALTER TABLE ${TABLA} ADD CONSTRAINT ${TABLA}_colectivo_check ${COLECTIVO_CHECK}`),
    ]);
    log.push(
      "collective_slug pasó a nullable y los dos CHECK se reemplazaron, en una transacción."
    );

    const formaDespues = await leerForma();
    const despues = await medir();
    const problemas = verificar(formaDespues);

    if (despues.filas !== antes.filas) {
      problemas.push(
        `${TABLA} tenía ${antes.filas} fila(s) y ahora tiene ${despues.filas}. Esta migración ` +
          "no inserta ni borra ninguna."
      );
    }

    log.push(`${TABLA}: ${despues.filas} fila(s), sin cambios de datos.`);
    log.push(
      problemas.length === 0
        ? "VERIFICADO: collective_slug acepta NULL y los dos CHECK quedaron con la definición " +
            "exacta esperada, comparada por definición y no por nombre."
        : `NO VERIFICADO: ${problemas.length} problema(s).`
    );
    for (const x of problemas) log.push(`  - ${x}`);
    log.push(
      "Y LA FORMA NO ES LA CORRECCIÓN: que el CHECK rechace lo que tiene que rechazar se mide " +
        "con INSERT de verdad en scripts/pruebas/edit-log-artista.mjs, no acá."
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
