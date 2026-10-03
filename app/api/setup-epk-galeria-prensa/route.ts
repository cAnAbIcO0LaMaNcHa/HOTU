/**
 * MIGRATION — las dos tablas que le faltan al EPK: galería y prensa.
 *
 *   /api/setup-epk-galeria-prensa?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-epk-galeria-prensa?secret=YOUR_SECRET
 *
 *   artist_photos — fotos en alta para que el organizador arme flyers.
 *   artist_press  — links a notas, con medio y fecha.
 *
 * ============================================================
 * NO SE PUDO REUSAR NADA, Y SE BUSCÓ PRIMERO
 * ============================================================
 *
 * La tanda 2 dejó la regla: NO crear artist_recordings ni artist_tracks, porque dj_sets y
 * tracks ya servían. Así que lo primero fue buscar qué reusar. No hay: artists.photo y
 * artists.cover_url son UNA imagen cada una —el avatar y la portada—, no una colección, y
 * no hay ninguna tabla de prensa. Dos tablas nuevas es lo que hay.
 *
 * ============================================================
 * SIN COLUMNAS EDITORIALES, Y NO ES UN OLVIDO
 * ============================================================
 *
 * Las 6 tablas editoriales comparten scope, country_code, language, status, featured y
 * priority_at porque se listan en el sitio y se moderan. Estas dos NO se listan en ningún
 * lado: se ven solo dentro del perfil del artista. Igual que artist_gigs y artist_likes,
 * que tampoco las tienen.
 *
 * Y ESO RESUELVE LA REGLA DE "ESCONDER A MEDIAS" SIN AGREGAR NADA. Al ocultar un perfil,
 * la censura alcanza también a sus sets y tracks, porque esos SÍ salen en /sets y
 * /discografia y dejarlos ahí sería esconder a medias. Una foto y una nota de prensa no
 * tienen otra vitrina: si el perfil se esconde, se fueron con él. Medido: ninguna página
 * fuera del perfil las lee.
 *
 * ============================================================
 * EL TOPE DE 12 FOTOS NO ESTÁ ACÁ, Y NO PUEDE ESTAR
 * ============================================================
 *
 * Un CHECK no puede contar filas de la tabla, así que el tope de 12 por artista vive en el
 * write path. Queda dicho acá para que nadie lo busque y lo "agregue" como constraint
 * creyendo que funciona: un CHECK que llame a una subconsulta no es inmutable y Postgres
 * lo rechaza.
 *
 * DONDE VA A RESOLVERSE ES EN EL WRITE PATH, QUE TODAVÍA NO EXISTE. Lo digo en futuro a
 * propósito: la primera versión de este comentario nombraba un lib/epk-galeria-write.ts
 * como si ya estuviera escrito, y no estaba. El reviewer lo marcó, y la falla es peor de
 * lo que parece — este párrafo existe justamente para que nadie busque el tope y lo
 * "agregue" como constraint, así que mandar al lector a un archivo que no está le deja dos
 * salidas malas: suponer que el tope ya está puesto en otro lado, o volver a intentar el
 * constraint que el párrafo desaconseja. El comentario que existe para evitar una
 * confusión la producía.
 *
 * Cuando se escriba, tiene que ser ATÓMICO: un INSERT ... SELECT que lleve el conteo en su
 * propio WHERE. Un "contar y después insertar" en dos consultas deja una ventana de un
 * round-trip en la que dos subidas ven 11 y las dos entran. Es el mismo razonamiento que el
 * índice único parcial de la residencia: la guarda tiene que estar donde la carrera no la
 * pueda saltar.
 *
 * Y MIENTRAS NO EXISTA EL WRITE PATH, EL TOPE NO EXISTE. La base acepta la foto número 13
 * sin chistar. No es un problema hoy —nada escribe en estas tablas todavía, medido— pero es
 * lo que hay, y conviene que esté dicho y no supuesto.
 *
 * ============================================================
 * ============================================================
 * TRES COSAS QUE ESTA MIGRACIÓN NO HACE, Y POR QUÉ NO
 * ============================================================
 *
 * Las marcó el reviewer y las tres son decisiones, no olvidos:
 *
 *   NO CUENTA LAS FILAS QUE VIOLARÍAN LOS CHECK antes del swap, como sí hace
 *   setup-event-time con end_at > starts_at. Ahí hacía falta porque la columna ya tenía
 *   datos. Acá las dos tablas las crea ESTA migración, vacías, y a partir de ahí el CHECK
 *   impide que nazca una fila que lo viole. Un conteo que solo puede dar cero no mide nada.
 *
 *   NO DETECTA CHECK NI ÍNDICES DE MÁS, aunque sí detecta FK de más. La asimetría tiene
 *   razón: un FK extra cambia qué se lleva el borrado de una cuenta, que es una decisión del
 *   schema; un CHECK extra solo puede ser más restrictivo, y entonces el que falla es quien
 *   lo puso, ruidosamente, al primer INSERT.
 *
 *   NO FILTRA SCHEMA en la sonda de existencia: pg_class por relname mira todos los
 *   schemas, mientras information_schema.columns sí filtra public. Si existiera un
 *   artist_photos fuera de public, daría existe:true con columnas:[] y la migración
 *   reportaría ruidosamente que faltan las seis columnas. Falla hacia el lado seguro, y está
 *   heredado de setup-account-removals.
 *
 * ============================================================
 * published_at ES NULLABLE, Y LOS ÍNDICES LO SABEN
 * ============================================================
 *
 * Una nota vieja de un blog puede no tener fecha, y la regla del repo es no inventar
 * datos: nulo es "no se sabe", no "hoy". Entonces el orden de lectura es
 * `sort_order ASC NULLS LAST, published_at DESC NULLS LAST`, y el índice lleva el
 * NULLS LAST ESCRITO: por default DESC ordena NULLS FIRST, así que sin decirlo el índice y
 * el lector pedirían órdenes distintos y el índice no se usaría. Misma convención que
 * sort_order en dj_sets y tracks: NULL = sin posición manual.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOTOS = "artist_photos";
const PRENSA = "artist_press";

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
type DefCol = [string, RegExp, boolean, string | null];

const COLUMNAS: Record<string, DefCol[]> = {
  [FOTOS]: [
    ["id", /integer/i, false, `nextval('${FOTOS}_id_seq'::regclass)`],
    ["artist_slug", /text/i, false, null],
    ["url", /text/i, false, null],
    // El crédito del fotógrafo es OPCIONAL: muchas fotos de fiesta no lo tienen, y
    // exigirlo haría que alguien escriba "desconocido" para poder guardar.
    ["credit", /text/i, true, null],
    ["sort_order", /integer/i, true, null],
    ["created_at", /timestamp with time zone/i, false, "now()"],
  ],
  [PRENSA]: [
    ["id", /integer/i, false, `nextval('${PRENSA}_id_seq'::regclass)`],
    ["artist_slug", /text/i, false, null],
    // El medio es TEXTO LIBRE y no una lista cerrada: la escena publica en blogs y en
    // Instagram, y una lista cerrada deja afuera justo lo que más hay.
    ["outlet", /text/i, false, null],
    ["url", /text/i, false, null],
    ["published_at", /date/i, true, null],
    ["sort_order", /integer/i, true, null],
    ["created_at", /timestamp with time zone/i, false, "now()"],
  ],
};

/**
 * Definiciones EXACTAS, para comparar la definición ENTERA y no subcadenas. La lección de
 * setby-moderation: buscando pedacitos, cinco de siete variantes falsas pasaban.
 *
 * Los valores de abajo son los que Postgres RINDE, no los que uno escribe: pg_get_constraintdef
 * envuelve la expresión en un par de paréntesis más. Si alguno no coincide, verificarForma
 * lo canta con las dos cadenas una debajo de la otra y se corrige desde lo medido.
 */
const CHECKS: Record<string, Array<[string, string]>> = {
  [FOTOS]: [
    [`${FOTOS}_url_check`, `CHECK ((btrim(url, '${BLANCOS}'::text) <> ''::text))`],
    /**
     * credit es nullable, así que el CHECK tiene que dejar pasar NULL EXPLÍCITAMENTE.
     * Sin el `IS NULL OR`, btrim(NULL) da NULL, un CHECK que da NULL pasa, y el efecto
     * sería el mismo — pero por tres-valores en vez de por lo que dice. Escrito así, lo
     * que el constraint permite se lee en el constraint.
     */
    [
      `${FOTOS}_credit_check`,
      `CHECK (((credit IS NULL) OR (btrim(credit, '${BLANCOS}'::text) <> ''::text)))`,
    ],
  ],
  [PRENSA]: [
    [`${PRENSA}_outlet_check`, `CHECK ((btrim(outlet, '${BLANCOS}'::text) <> ''::text))`],
    [`${PRENSA}_url_check`, `CHECK ((btrim(url, '${BLANCOS}'::text) <> ''::text))`],
  ],
};

/**
 * ON DELETE CASCADE Y NO SET NULL, al revés que dj_sets y tracks, y la diferencia tiene
 * razón: ahí artist_slug es nullable y artist_name no, así que la fila sobrevive perdiendo
 * el vínculo y sigue saliendo en /sets bajo el nombre del artista. Una foto sin artista no
 * tiene dónde mostrarse ni de quién ser. Igual que artist_gigs y artist_likes, que ya van
 * CASCADE.
 *
 * (Este bloque estaba colgado de const INDICES, que no es lo que documenta. Lo marcó el
 * reviewer.)
 */
const FKS: Record<string, Array<[string, string]>> = {
  [FOTOS]: [
    [
      `${FOTOS}_artist_slug_fkey`,
      "FOREIGN KEY (artist_slug) REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE",
    ],
  ],
  [PRENSA]: [
    [
      `${PRENSA}_artist_slug_fkey`,
      "FOREIGN KEY (artist_slug) REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE",
    ],
  ],
};

const INDICES: Record<string, Array<[string, string]>> = {
  [FOTOS]: [
    [
      `${FOTOS}_artist_orden_idx`,
      `CREATE INDEX ${FOTOS}_artist_orden_idx ON public.${FOTOS} USING btree (artist_slug, sort_order, created_at DESC)`,
    ],
  ],
  [PRENSA]: [
    [
      `${PRENSA}_artist_orden_idx`,
      `CREATE INDEX ${PRENSA}_artist_orden_idx ON public.${PRENSA} USING btree (artist_slug, sort_order, published_at DESC NULLS LAST)`,
    ],
  ],
};

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { existe: boolean; columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { formas: Record<string, Forma>; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  for (const tabla of [FOTOS, PRENSA]) {
    const f = e.formas[tabla];
    if (!f?.existe) {
      p.push(`falta la tabla ${tabla}`);
      continue;
    }

    for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS[tabla]) {
      const c = f.columnas.find((x) => x.nombre === nombre);
      if (!c) {
        p.push(`falta ${tabla}.${nombre}`);
        continue;
      }
      if (!patronTipo.test(c.tipo)) p.push(`${tabla}.${nombre} EXISTE PERO es ${c.tipo}`);
      if (c.aceptaNull !== aceptaNull) {
        p.push(
          `${tabla}.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`
        );
      }
      if ((c.default ?? null) !== def) {
        p.push(
          `${tabla}.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`
        );
      }
    }

    const exacto = (lista: string[], nombre: string, esperado: string, que: string) => {
      const linea = lista.find((x) => x.startsWith(`${nombre}: `));
      if (!linea) {
        p.push(`falta ${que} ${nombre} en ${tabla}`);
        return;
      }
      const real = linea.slice(nombre.length + 2);
      if (real !== esperado) {
        p.push(
          `${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
        );
      }
    };

    for (const [n, d] of CHECKS[tabla]) exacto(f.checks, n, d, "el CHECK");
    for (const [n, d] of FKS[tabla]) exacto(f.fks, n, d, "el FK");
    for (const [n, d] of INDICES[tabla]) exacto(f.indices, n, d, "el índice");

    /**
     * Que no haya FK DE MÁS también es forma. Un FK extra hacia user_profiles —por
     * ejemplo un "subido_por"— cambiaría qué se lleva el borrado de una cuenta, que es
     * una decisión del schema y no del código.
     */
    if (f.fks.length !== FKS[tabla].length) {
      p.push(
        `${tabla} tiene ${f.fks.length} FK y se esperaban ${FKS[tabla].length} (${f.fks.join("; ")})`
      );
    }
  }

  return { ok: p.length === 0, problemas: p };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!process.env.MIGRATE_SECRET || searchParams.get("secret") !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const formaDe = async (tabla: string): Promise<Forma> => {
    const [existe] = await sql`SELECT 1 FROM pg_class WHERE relname = ${tabla}`;
    if (!existe) return { existe: false, columnas: [], checks: [], fks: [], indices: [] };
    const columnas = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tabla} ORDER BY ordinal_position
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
      existe: true,
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
    const formas: Record<string, Forma> = {};
    for (const t of [FOTOS, PRENSA]) formas[t] = await formaDe(t);

    /**
     * Conteos de lo que esta migración podría tocar si estuviera mal escrita. Se cuenta
     * artists aunque no se modifique: un FK mal puesto o un DROP de más se vería acá, y
     * una medición que no puede cambiar no prueba nada.
     */
    const [a] = await sql`SELECT COUNT(*)::int AS n FROM artists`;
    const conteos: Record<string, number> = { filas_artists: a.n as number };
    for (const t of [FOTOS, PRENSA]) {
      conteos[`filas_${t}`] = 0;
      if (formas[t].existe) {
        const [r] = await sql(`SELECT COUNT(*)::int AS n FROM ${t}`);
        conteos[`filas_${t}`] = r.n as number;
      }
    }
    return { formas, conteos };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: las dos tablas ya están con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push("SIN BACKFILL: las dos tablas arrancan VACÍAS. No se inventa contenido.");
      log.push(
        "El tope de 12 fotos por artista NO es un CHECK —no se puede contar filas en un " +
          "constraint— y TODAVÍA NO EXISTE: va a vivir en el write path, que no está escrito. " +
          "Hoy la base acepta la foto 13. Nada escribe en estas tablas todavía."
      );
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. filas_artists no puede cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /* ============ LAS TABLAS ============
     * CREATE TABLE IF NOT EXISTS compara por NOMBRE y se saltea entero si ya existe algo
     * llamado así con otra forma. Por eso después van los ADD COLUMN uno por uno, y los
     * CHECK, FK e índices por SWAP: cada corrida RE-AFIRMA la forma.
     *
     * Las dos tablas van en UNA transacción. Postgres tiene DDL transaccional incluso
     * entre tablas distintas —medido en este repo, con una transacción de un DDL bueno y
     * uno malo que revirtió el bueno— así que o entran las dos o ninguna. Media migración
     * aplicada es un estado que nadie eligió y que hay que averiguar.
     */
    await sql.transaction([
      sql(`
        CREATE TABLE IF NOT EXISTS ${FOTOS} (
          id SERIAL PRIMARY KEY,
          artist_slug TEXT NOT NULL REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
          url TEXT NOT NULL,
          credit TEXT,
          sort_order INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `),
      sql(`
        CREATE TABLE IF NOT EXISTS ${PRENSA} (
          id SERIAL PRIMARY KEY,
          artist_slug TEXT NOT NULL REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
          outlet TEXT NOT NULL,
          url TEXT NOT NULL,
          published_at DATE,
          sort_order INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `),
    ]);

    /**
     * Los ADD COLUMN, en UNA transacción y SIN NOT NULL.
     *
     * Van sin NOT NULL SALVO LOS DOS created_at, QUE LO LLEVAN CON DEFAULT. Lo que falla
     * sobre una tabla con filas es un ADD COLUMN NOT NULL *sin default*; con DEFAULT now()
     * Postgres puede llenar las filas existentes, así que ahí sí se puede afirmar.
     *
     * (El título de este bloque decía "SIN NOT NULL" a secas y era falso para esos dos. El
     * razonamiento siempre fue el correcto; la frase que lo encabezaba, no. Está heredado
     * palabra por palabra de setup-account-removals, que tiene la misma discrepancia.)
     *
     * Para el resto, el NOT NULL definitivo lo afirma el CREATE TABLE de arriba, y si no
     * quedó, verificarForma lo canta.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${FOTOS} ADD COLUMN IF NOT EXISTS artist_slug TEXT`),
      sql(`ALTER TABLE ${FOTOS} ADD COLUMN IF NOT EXISTS url TEXT`),
      sql(`ALTER TABLE ${FOTOS} ADD COLUMN IF NOT EXISTS credit TEXT`),
      sql(`ALTER TABLE ${FOTOS} ADD COLUMN IF NOT EXISTS sort_order INTEGER`),
      sql(`ALTER TABLE ${FOTOS} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`),
      sql(`ALTER TABLE ${PRENSA} ADD COLUMN IF NOT EXISTS artist_slug TEXT`),
      sql(`ALTER TABLE ${PRENSA} ADD COLUMN IF NOT EXISTS outlet TEXT`),
      sql(`ALTER TABLE ${PRENSA} ADD COLUMN IF NOT EXISTS url TEXT`),
      sql(`ALTER TABLE ${PRENSA} ADD COLUMN IF NOT EXISTS published_at DATE`),
      sql(`ALTER TABLE ${PRENSA} ADD COLUMN IF NOT EXISTS sort_order INTEGER`),
      sql(`ALTER TABLE ${PRENSA} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`),
    ]);

    /* ============ CHECKS, FK E ÍNDICES, POR SWAP ============
     * DROP IF EXISTS + ADD desnudo, los dos en una transacción. Sin la transacción hay una
     * ventana de un round-trip sin guarda; y si una fila violara el ADD, tira
     * check_violation —que NO es duplicate_object y por lo tanto el envoltorio
     * DO $$ EXCEPTION WHEN duplicate_object $$ no lo atraparía— y la transacción deja la
     * guarda vieja en su lugar en vez de dejar la tabla sin ninguna.
     *
     * El ADD va DESNUDO a propósito: después del DROP no queda nada con ese nombre que
     * duplicar, así que un handler de duplicados solo podría tragarse un error real.
     */
    for (const tabla of [FOTOS, PRENSA]) {
      for (const [nombre, definicion] of CHECKS[tabla]) {
        await sql.transaction([
          sql(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`),
          sql(`ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} ${definicion}`),
        ]);
      }
      for (const [nombre, definicion] of FKS[tabla]) {
        await sql.transaction([
          sql(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`),
          sql(`ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} ${definicion}`),
        ]);
      }
      for (const [nombre, definicion] of INDICES[tabla]) {
        await sql.transaction([sql(`DROP INDEX IF EXISTS ${nombre}`), sql(definicion)]);
      }
    }

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: ${FOTOS} con sus 6 columnas y ${PRENSA} con sus 7, cada una con su FK a ` +
            "artists(slug) ON UPDATE CASCADE ON DELETE CASCADE, sus CHECK de blancos y su índice de orden."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe ni borra una sola ` +
          "fila, así que en main lo más probable es tráfico legítimo entre las dos mediciones " +
          "—un artista que se dio de alta mientras corría— y no un efecto de la migración."
      );
    } else {
      log.push(`Sin cambios en los datos: ${JSON.stringify(despues.conteos)}.`);
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
