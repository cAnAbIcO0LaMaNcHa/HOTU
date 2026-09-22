/**
 * MIGRATION — censura de contenido y ban de cuentas (tanda 5 §4).
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-moderation?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-moderation?secret=YOUR_SECRET
 *
 * El admin deja de ser un CMS y pasa a ser solo moderación. Esto agrega
 * las dos marcas que esa moderación necesita y que hoy no existen.
 *
 * PURAMENTE ADITIVA Y SIN BACKFILL. 21 columnas nuevas, 7 CHECK, 7 FK y
 * 7 índices parciales. Ninguna fila se toca, ningún default cambia.
 *
 * ============================================================
 * NO HAY BACKFILL, Y ESO NO ES UNA CASUALIDAD
 * ============================================================
 *
 * Todas las columnas entran NULLABLE y SIN DEFAULT, y NULL significa "no
 * censurado" / "no baneado". Como no hay ningún estado previo que
 * traducir, no hay UPDATE de relleno, y sin UPDATE de relleno no existe
 * la pregunta de cuál es su guarda — que es el patrón que AGENTS.md pide
 * revisar explícitamente antes de correr cualquier migración con
 * backfill, porque ya apareció dos veces (el renombre de kind, y
 * review_status).
 *
 * Es la forma más segura de migración que hay, y se puede elegir cada
 * vez que el estado inicial de una columna nueva coincida con NULL.
 *
 * ============================================================
 * LA CENSURA NO REUSA status. NUNCA.
 * ============================================================
 *
 * Es una marca propia, que pone y saca SOLO un moderador.
 *
 * Si censurar fuera poner status='draft', el autor lo vería como un
 * borrador SUYO y lo republicaría sin enterarse de que lo moderaron. Y
 * al revés: un autor que despublica algo por su cuenta no puede quedar
 * marcado como censurado. Son dos hechos distintos, de dos personas
 * distintas, y tienen que poder existir a la vez:
 *
 *   status        — si el AUTOR quiere que se vea.
 *   censored_at   — si un MODERADOR lo bajó.
 *
 * El lector público exige las dos cosas. El autor ve la suya y ve la
 * ajena, con el motivo, y no puede sacarla.
 *
 * ============================================================
 * MOTIVO OBLIGATORIO, EN EL SCHEMA Y NO SOLO EN EL CÓDIGO
 * ============================================================
 *
 * Los 7 CHECK exigen que una fila marcada tenga un motivo que no sea
 * blanco. Es la misma regla que el rechazo de un perfil de DJ y existe
 * por lo mismo: contenido que desaparece sin razón hace que la gente se
 * vaya de la plataforma, y una regla que vive solo en el código es una
 * regla que alguien se olvida.
 *
 * El btrim va CON su segundo argumento. Con uno solo recorta únicamente
 * el espacio ASCII, así que un motivo que quedó en un salto de línea o
 * en un espacio duro pegado de un documento pasaría el CHECK, y el autor
 * vería una pantalla de censura con el motivo en blanco.
 *
 * ============================================================
 * censored_by NO ESTÁ EN NINGÚN CHECK, Y ES A PROPÓSITO
 * ============================================================
 *
 * Su FK es ON DELETE SET NULL: si algún día se borra la cuenta del
 * moderador, la censura sobrevive perdiendo el nombre de quien la puso.
 * Si el CHECK exigiera censored_by, ese SET NULL violaría el CHECK y el
 * DELETE fallaría — la trampa exacta de artist_gigs, donde event_id
 * tuvo que ir CASCADE porque SET NULL rompía su CHECK.
 *
 * Lo que no puede perderse es el MOTIVO, y ese sí está en el CHECK.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Las seis tablas de contenido público que se pueden censurar. */
const TABLAS = ["artists", "collectives", "events", "news", "dj_sets", "tracks"] as const;
type Tabla = (typeof TABLAS)[number];

/** Las tres columnas de censura, con el tipo que tienen que tener. */
const COLS_CENSURA: Array<[string, RegExp]> = [
  ["censored_at", /timestamp with time zone/i],
  ["censored_by", /text/i],
  ["censor_reason", /text/i],
];

/** Las tres del ban, sobre user_profiles. */
const COLS_BAN: Array<[string, RegExp]> = [
  ["banned_at", /timestamp with time zone/i],
  ["banned_by", /text/i],
  ["ban_reason", /text/i],
];

/**
 * El conjunto de blancos que recorta el btrim: espacio, tab, CR, LF y el
 * espacio duro. Se escribe con escapes y no con los caracteres de
 * verdad, para que ninguna herramienta que toque este archivo los coma.
 */
const BLANCOS = " \t\r\n\u00A0";

/**
 * ============================================================
 * SE COMPARA LA DEFINICIÓN ENTERA, NO SUBCADENAS
 * ============================================================
 *
 * La versión anterior de esto buscaba tres pedacitos sueltos dentro del
 * texto del CHECK y daba por bueno cualquier cosa que los contuviera. El
 * migration-reviewer probó siete variantes y CINCO pasaban, entre ellas:
 *
 *   - un OR plano en vez del AND anidado — permite censurar SIN motivo,
 *     que es exactamente lo que el CHECK existe para prohibir;
 *   - btrim(...) = '' en vez de <> '' — exige que el motivo esté vacío;
 *   - el predicado entero envuelto en NOT(...) — prohíbe lo legal;
 *   - una tautología que no restringe nada;
 *   - ... NOT VALID, que no validó las filas que ya estaban.
 *
 * Y el comentario de esa función afirmaba que miraba el orden. No lo
 * miraba. Un verificador que afirma de más es peor que no tener uno: el
 * log decía "VERIFICADO" sobre una tabla sin guarda.
 *
 * pg_get_constraintdef y pg_indexes rinden de forma determinística, así
 * que la comparación exacta es posible. Si una versión futura de
 * Postgres cambiara el formato, esto va a fallar RUIDOSAMENTE con un
 * "tiene otra forma" — que es la dirección correcta en la que fallar.
 */
const checkCensuraEsperado =
  "CHECK (((censored_at IS NULL) OR ((censor_reason IS NOT NULL) AND " +
  `(btrim(censor_reason, '${BLANCOS}'::text) <> ''::text))))`;

const checkBanEsperado =
  "CHECK (((banned_at IS NULL) OR ((ban_reason IS NOT NULL) AND " +
  `(btrim(ban_reason, '${BLANCOS}'::text) <> ''::text))))`;

const fkEsperado = (columna: string) =>
  `FOREIGN KEY (${columna}) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL`;

const indiceEsperado = (tabla: string, nombre: string, columna: string) =>
  `CREATE INDEX ${nombre} ON public.${tabla} USING btree (${columna}) WHERE (${columna} IS NOT NULL)`;

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { tablas: Record<string, Forma>; conteos: Record<string, number> };

/**
 * La verificación mira DEFINICIONES, no nombres.
 *
 * ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT dentro del DO y CREATE INDEX
 * IF NOT EXISTS comparan por NOMBRE y se saltean en silencio. Una
 * censored_at preexistente como TEXT, o un índice con ese nombre sobre
 * otra columna, devolverían ok:true sin que nada de esto exista de
 * verdad. Por eso se compara el tipo de cada columna, la forma de cada
 * CHECK y la definición de cada índice.
 *
 * Y corre en los DOS caminos, el dryRun y el real. Tenerla solo en el
 * dryRun deja sin verificar justo al que aplica el DDL.
 */
function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const problemas: string[] = [];

  const mirarColumnas = (tabla: string, cols: Array<[string, RegExp]>) => {
    const f = e.tablas[tabla];
    if (!f) {
      problemas.push(`no pude leer la forma de ${tabla}`);
      return;
    }
    for (const [nombre, patronTipo] of cols) {
      const c = f.columnas.find((x) => x.nombre === nombre);
      if (!c) {
        problemas.push(`falta ${tabla}.${nombre}`);
        continue;
      }
      if (!patronTipo.test(c.tipo)) {
        problemas.push(`${tabla}.${nombre} EXISTE PERO es ${c.tipo}, no el tipo esperado`);
      }
      // Tienen que aceptar NULL: NULL es "no marcado", que es el estado
      // de absolutamente todas las filas que ya existen.
      if (!c.aceptaNull) {
        problemas.push(`${tabla}.${nombre} EXISTE PERO es NOT NULL, y NULL es "sin marcar"`);
      }
      // Y sin DEFAULT. Un default distinto de NULL marcaría cada fila
      // nueva como censurada o baneada apenas nazca.
      if (c.default !== null) {
        problemas.push(`${tabla}.${nombre} EXISTE PERO tiene default ${c.default}, y no debería tener`);
      }
    }
  };

  /** La definición de `nombre`, tal cual la rinde Postgres, o null. */
  const definicion = (lista: string[] | undefined, nombre: string): string | null => {
    const linea = lista?.find((x) => x.startsWith(`${nombre}: `));
    return linea ? linea.slice(nombre.length + 2) : null;
  };

  const mirarExacto = (
    lista: string[] | undefined,
    nombre: string,
    esperado: string,
    queEs: string
  ) => {
    const real = definicion(lista, nombre);
    if (real === null) {
      problemas.push(`falta ${queEs} ${nombre}`);
      return;
    }
    if (real !== esperado) {
      problemas.push(
        `${queEs} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
      );
    }
  };

  for (const t of TABLAS) {
    mirarColumnas(t, COLS_CENSURA);
    const f = e.tablas[t];
    mirarExacto(f?.checks, `${t}_censura_con_motivo_check`, checkCensuraEsperado, "el CHECK");
    mirarExacto(f?.fks, `${t}_censored_by_fkey`, fkEsperado("censored_by"), "el FK");
    mirarExacto(
      f?.indices,
      `${t}_censored_idx`,
      indiceEsperado(t, `${t}_censored_idx`, "censored_at"),
      "el índice"
    );
  }

  mirarColumnas("user_profiles", COLS_BAN);
  const up = e.tablas.user_profiles;
  mirarExacto(up?.checks, "user_profiles_ban_con_motivo_check", checkBanEsperado, "el CHECK");
  mirarExacto(up?.fks, "user_profiles_banned_by_fkey", fkEsperado("banned_by"), "el FK");
  mirarExacto(
    up?.indices,
    "user_profiles_banned_idx",
    indiceEsperado("user_profiles", "user_profiles_banned_idx", "banned_at"),
    "el índice"
  );

  return { ok: problemas.length === 0, problemas };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const formaDe = async (tabla: string, nombres: string[]): Promise<Forma> => {
    const columnas = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tabla}
        AND column_name = ANY(${nombres})
      ORDER BY column_name
    `;
    const cons = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = ${tabla}::regclass ORDER BY conname
    `;
    const indices = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${tabla} ORDER BY indexname
    `;
    return {
      columnas: columnas.map((c) => ({
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      checks: cons.filter((c) => c.contype === "c").map((c) => `${c.conname}: ${c.def}`),
      fks: cons.filter((c) => c.contype === "f").map((c) => `${c.conname}: ${c.def}`),
      indices: indices.map((r) => `${r.indexname}: ${r.indexdef}`),
    };
  };

  const estado = async (): Promise<Estado> => {
    const tablas: Record<string, Forma> = {};
    for (const t of TABLAS) {
      tablas[t] = await formaDe(
        t,
        COLS_CENSURA.map(([n]) => n)
      );
    }
    tablas.user_profiles = await formaDe(
      "user_profiles",
      COLS_BAN.map(([n]) => n)
    );

    // Cuántas filas están marcadas HOY. Es lo que prueba que la
    // migración no tocó datos: estos números tienen que ser idénticos
    // antes y después, y cero en la primera corrida.
    const conteos: Record<string, number> = {};
    for (const t of TABLAS) {
      /**
       * El TOTAL de filas, no solo las marcadas.
       *
       * Sin esto, la prueba de "no se tocó ningún dato" comparaba dos
       * ceros sintéticos en la primera corrida: estado() devuelve 0
       * cuando la columna todavía no existe, así que el "antes" no era
       * una medición sino una constante. El total de filas siempre es
       * una medición, exista o no la columna.
       */
      const [tot] = await sql(`SELECT COUNT(*)::int AS n FROM ${t}`);
      conteos[`filas_${t}`] = tot.n as number;

      const tiene = tablas[t].columnas.some((c) => c.nombre === "censored_at");
      if (!tiene) {
        conteos[t] = 0;
        continue;
      }
      const [r] = await sql(`SELECT COUNT(*)::int AS n FROM ${t} WHERE censored_at IS NOT NULL`);
      conteos[t] = r.n as number;
    }
    const [totCuentas] = await sql`SELECT COUNT(*)::int AS n FROM user_profiles`;
    conteos.filas_user_profiles = totCuentas.n as number;

    const tieneBan = tablas.user_profiles.columnas.some((c) => c.nombre === "banned_at");
    if (tieneBan) {
      const [r] = await sql`SELECT COUNT(*)::int AS n FROM user_profiles WHERE banned_at IS NOT NULL`;
      conteos.cuentas_baneadas = r.n as number;
    } else {
      conteos.cuentas_baneadas = 0;
    }
    return { tablas, conteos };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está todo con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const p of v.problemas) log.push(`  - ${p}`);
      if (!v.ok) {
        log.push(
          "Los que dicen 'falta' los crea esta corrida. Los que dicen 'EXISTE PERO' NO: IF NOT EXISTS compara por nombre y se saltea en silencio."
        );
      }
      log.push(
        "SIN BACKFILL: ninguna fila se toca. NULL es 'sin marcar', que es el estado de todo lo que ya existe."
      );
      log.push(
        `Marcadas hoy: ${JSON.stringify(antes.conteos)}. Estos números no pueden cambiar.`
      );
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /* ==============================================================
     * LAS COLUMNAS. Todas en una transacción por tabla.
     * ============================================================== */
    for (const t of TABLAS) {
      await sql.transaction([
        sql(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS censored_at TIMESTAMPTZ`),
        sql(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS censored_by TEXT`),
        sql(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS censor_reason TEXT`),
      ]);
    }
    await sql.transaction([
      sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ`,
      sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS banned_by TEXT`,
      sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ban_reason TEXT`,
    ]);
    // NO se afirma nada acá: lo que quedó lo dice la verificación de
    // abajo, que mide. Esta línea y su gemela se imprimían
    // incondicionalmente, idénticas en la corrida donde el DDL no creaba
    // nada. Un log que afirma sin verificar es peor que no loguear.

    /* ==============================================================
     * LOS CHECK, LOS FK Y LOS ÍNDICES: SWAP, NO "SI NO ESTÁ".
     *
     * Van DROP IF EXISTS + ADD, los dos juntos en una transacción, y el
     * ADD desnudo sin envoltorio de excepciones.
     *
     * La versión anterior hacía ADD dentro de un
     * DO $$ ... EXCEPTION WHEN duplicate_object $$, que parece lo
     * prolijo y esconde el peor caso: si ya existe algo con ese nombre
     * y OTRA forma —un intento anterior, un arreglo a mano, una versión
     * vieja de esta misma ruta—, el ADD choca por nombre, el handler se
     * come el error, el constraint malo se queda, y la migración
     * informa que quedó todo bien. Un CHECK con un OR plano en lugar
     * del AND anidado permite censurar SIN motivo: exactamente lo que
     * esa guarda existe para impedir.
     *
     * Con el swap, cada corrida RE-AFIRMA la definición en vez de
     * confiar en que la primera la dejó bien. Y si alguna fila la
     * violara, el ADD tira check_violation ruidosamente y la
     * transacción vuelve atrás dejando la guarda vieja en su lugar —
     * que es la dirección correcta en la que fallar.
     *
     * La transacción no es prolijidad: entre el DROP y el ADD hay una
     * ventana real de un round-trip, porque cada sql del driver HTTP de
     * Neon es su propio request, y ahí la tabla no tiene guarda.
     * ============================================================== */
    for (const t of TABLAS) {
      await sql.transaction([
        sql(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_censura_con_motivo_check`),
        sql(`ALTER TABLE ${t} ADD CONSTRAINT ${t}_censura_con_motivo_check
             CHECK (censored_at IS NULL
                    OR (censor_reason IS NOT NULL
                        AND btrim(censor_reason, E' \\t\\r\\n\\u00A0') <> ''))`),
      ]);
      await sql.transaction([
        sql(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_censored_by_fkey`),
        sql(`ALTER TABLE ${t} ADD CONSTRAINT ${t}_censored_by_fkey
             FOREIGN KEY (censored_by) REFERENCES user_profiles(email)
             ON UPDATE CASCADE ON DELETE SET NULL`),
      ]);
      // Parcial sobre lo MARCADO, que es siempre un puñado. El lector
      // público pregunta por IS NULL —casi todas las filas— y ahí un
      // índice no sirve de nada; el que lo necesita es el moderador,
      // que pide la lista de lo censurado.
      //
      // También va por swap: un índice preexistente con este nombre
      // pero UNIQUE haría fallar la segunda censura del día con un
      // unique_violation, y CREATE INDEX IF NOT EXISTS no lo corregiría
      // nunca porque compara por nombre.
      await sql.transaction([
        sql(`DROP INDEX IF EXISTS ${t}_censored_idx`),
        sql(`CREATE INDEX ${t}_censored_idx ON ${t} (censored_at) WHERE censored_at IS NOT NULL`),
      ]);
    }

    await sql.transaction([
      sql(`ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_ban_con_motivo_check`),
      sql(`ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_ban_con_motivo_check
           CHECK (banned_at IS NULL
                  OR (ban_reason IS NOT NULL
                      AND btrim(ban_reason, E' \\t\\r\\n\\u00A0') <> ''))`),
    ]);
    // Auto-referencia: quien banea es una cuenta de la misma tabla.
    await sql.transaction([
      sql(`ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_banned_by_fkey`),
      sql(`ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_banned_by_fkey
           FOREIGN KEY (banned_by) REFERENCES user_profiles(email)
           ON UPDATE CASCADE ON DELETE SET NULL`),
    ]);
    await sql.transaction([
      sql(`DROP INDEX IF EXISTS user_profiles_banned_idx`),
      sql(`CREATE INDEX user_profiles_banned_idx ON user_profiles (banned_at) WHERE banned_at IS NOT NULL`),
    ]);

    const despues = await estado();
    const v = verificarForma(despues);

    log.push(
      v.ok
        ? `VERIFICADO: las 21 columnas, los 7 CHECK, los 7 FK y los 7 índices quedaron con la forma esperada.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const p of v.problemas) log.push(`  - ${p}`);

    // La prueba de que no se tocó ningún dato: los conteos de marcados
    // tienen que ser IDÉNTICOS a los de antes.
    const cambiaron = Object.keys(despues.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió la cantidad de filas marcadas en ${cambiaron.join(", ")}. Esta migración no escribe datos; esto no debería poder pasar.`
      );
    } else {
      log.push(
        `Sin cambios en los datos: ${JSON.stringify(despues.conteos)}, igual que antes.`
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && cambiaron.length === 0,
      problemas: v.problemas,
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
