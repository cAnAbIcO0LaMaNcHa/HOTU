/**
 * MIGRATION — el registro de quién administra un colectivo (§8).
 *
 *   /api/setup-collective-ownership?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-collective-ownership?secret=YOUR_SECRET
 *
 * PURAMENTE ADITIVA Y SIN BACKFILL. Una tabla nueva y una columna.
 *
 * ============================================================
 * UNA TABLA PARA CUATRO PIEZAS QUE PEDÍAN LO MISMO
 * ============================================================
 *
 * Cada fila es UN CAMBIO de administración, ofrecido o hecho. Cuatro
 * piezas que iban a necesitar almacenamiento propio caen en la misma
 * forma:
 *
 *   cesion     — el dueño se lo ofrece a un miembro. Queda pendiente
 *                hasta que esa persona acepte o rechace. LAS
 *                OBLIGACIONES DE ADMINISTRAR NO SE LE ENCAJAN A NADIE:
 *                es el mismo principio que las membresías, donde entrar
 *                necesita las dos partes.
 *   desamparo  — el dueño lo suelta. Esta fila es la que RECUERDA quién
 *                era, que es lo único que permite reactivarlo después.
 *   reclamo    — alguien dice que es suyo y un moderador decide. Es la
 *                cola de la pieza 2, sin inventarle una tabla.
 *   moderacion — un moderador lo traspasó. Con motivo obligatorio, que
 *                hoy se pierde: la herramienta lo pide y no lo guarda en
 *                ningún lado.
 *
 * ============================================================
 * NO HAY BACKFILL, Y NO ES PEREZA
 * ============================================================
 *
 * Sería tentador crear una fila inicial por cada colectivo que ya tiene
 * dueño, para que el registro "empiece completo". No se hace: no sabemos
 * cuándo ni cómo esa persona pasó a administrarlo, y ponerle una fecha
 * inventada sería afirmar algo que el dato no dice. Es la misma razón por
 * la que artists.sets y top_tracks NO se migraron a dj_sets: copiarlos
 * con fechas inventadas habría metido basura en las tablas buenas.
 *
 * El registro empieza vacío y se llena con lo que de verdad pase.
 *
 * ============================================================
 * to_email NO ESTÁ EN NINGÚN CHECK
 * ============================================================
 *
 * Su FK es ON DELETE SET NULL, para que borrar una cuenta no se lleve el
 * historial de lo que administró. Si un CHECK exigiera to_email, ese SET
 * NULL lo violaría y el DELETE fallaría — la trampa de artist_gigs, donde
 * event_id tuvo que ir CASCADE porque SET NULL rompía su CHECK. Es la
 * misma decisión que censored_by.
 *
 * Que una cesión tenga destinatario lo garantiza el camino de escritura.
 *
 * ============================================================
 * revoked_at, Y POR QUÉ EL ÍNDICE MIRA to_email
 * ============================================================
 *
 * Lo encontró el migration-reviewer, y son dos agujeros con un arreglo.
 *
 * El primero: una cesión pendiente cuyo destinatario se borra la cuenta
 * queda HUÉRFANA. El ON DELETE SET NULL le vacía to_email, pero la fila
 * sigue teniendo accepted_at y declined_at en NULL, así que el índice
 * único seguía contándola como "la cesión abierta" del colectivo. Nadie
 * podía cerrarla —no hay a quién aceptar— y el colectivo quedaba trabado
 * para siempre, sin poder ofrecerse a nadie más. No falla: BLOQUEA, que
 * es el tipo de cosa que aparece meses después.
 *
 * El segundo lo vi mirando el primero: EL DUEÑO NO PODÍA CANCELAR una
 * cesión que ofreció. Ofrecés, la otra persona no contesta nunca, y no
 * hay salida. Eso faltaba desde el principio y no lo había visto.
 *
 * revoked_at resuelve los dos, y el predicado del índice único agrega
 * `revoked_at IS NULL AND to_email IS NOT NULL`: una cesión solo traba
 * mientras de verdad esté esperando una respuesta que alguien pueda dar.
 *
 * El CHECK de la respuesta usa num_nonnulls, que dice exactamente lo que
 * se quiere decir —como máximo UNA de las tres— en vez de tres pares de
 * comparaciones que hay que leer dos veces.
 *
 * ============================================================
 * artist_collectives.can_edit
 * ============================================================
 *
 * La pieza C: el dueño habilita a miembros para editar. Entra NOT NULL
 * DEFAULT false, que REPRODUCE EXACTAMENTE lo que pasa hoy —solo el dueño
 * edita—, así que la migración no cambia nada observable. Y como nadie
 * hace un UPDATE que filtre por ese default, no existe el patrón de la
 * guarda que la propia migración escribe.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "collective_ownership";

/**
 * El conjunto de blancos del btrim: espacio, tab, CR, LF y espacio duro.
 * Con escapes y no con los caracteres de verdad, para que ninguna
 * herramienta que toque este archivo se los coma.
 */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["id", /integer/i, false, `nextval('${TABLA}_id_seq'::regclass)`],
  ["collective_slug", /text/i, false, null],
  ["kind", /text/i, false, null],
  ["from_email", /text/i, true, null],
  ["to_email", /text/i, true, null],
  ["note", /text/i, true, null],
  ["offered_at", /timestamp with time zone/i, false, "now()"],
  ["accepted_at", /timestamp with time zone/i, true, null],
  ["declined_at", /timestamp with time zone/i, true, null],
  ["revoked_at", /timestamp with time zone/i, true, null],
];

/**
 * Las definiciones EXACTAS, medidas contra Postgres y no supuestas.
 *
 * Comparar la definición entera y no subcadenas es la lección del
 * migration-reviewer sobre setup-moderation: buscando tres pedacitos,
 * cinco de siete variantes falsas pasaban — entre ellas un OR plano que
 * permitía justo lo que el CHECK prohíbe, y el predicado envuelto en
 * NOT(). Si una versión futura de Postgres cambia el formato, esto falla
 * RUIDOSAMENTE, que es la dirección correcta.
 */
const CHECKS: Array<[string, string]> = [
  [
    `${TABLA}_kind_check`,
    "CHECK ((kind = ANY (ARRAY['cesion'::text, 'desamparo'::text, 'reclamo'::text, 'moderacion'::text])))",
  ],
  [
    `${TABLA}_respuesta_unica_check`,
    "CHECK ((num_nonnulls(accepted_at, declined_at, revoked_at) <= 1))",
  ],
  [
    `${TABLA}_motivo_check`,
    `CHECK (((kind <> 'moderacion'::text) OR ((note IS NOT NULL) AND (btrim(note, '${BLANCOS}'::text) <> ''::text))))`,
  ],
];

const FKS: Array<[string, string]> = [
  [
    `${TABLA}_collective_slug_fkey`,
    "FOREIGN KEY (collective_slug) REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE",
  ],
  [
    `${TABLA}_from_email_fkey`,
    "FOREIGN KEY (from_email) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
  ],
  [
    `${TABLA}_to_email_fkey`,
    "FOREIGN KEY (to_email) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
  ],
];

const INDICES: Array<[string, string]> = [
  [
    `${TABLA}_una_cesion_abierta_idx`,
    `CREATE UNIQUE INDEX ${TABLA}_una_cesion_abierta_idx ON public.${TABLA} USING btree (collective_slug) WHERE ((kind = 'cesion'::text) AND (accepted_at IS NULL) AND (declined_at IS NULL) AND (revoked_at IS NULL) AND (to_email IS NOT NULL))`,
  ],
  [
    `${TABLA}_bandeja_idx`,
    `CREATE INDEX ${TABLA}_bandeja_idx ON public.${TABLA} USING btree (to_email) WHERE ((accepted_at IS NULL) AND (declined_at IS NULL) AND (revoked_at IS NULL))`,
  ],
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = {
  existeTabla: boolean;
  ownership: Forma;
  artistCollectives: Forma;
  conteos: Record<string, number>;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  if (!e.existeTabla) {
    p.push(`falta la tabla ${TABLA}`);
    return { ok: false, problemas: p };
  }

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = e.ownership.columnas.find((x) => x.nombre === nombre);
    if (!c) {
      p.push(`falta ${TABLA}.${nombre}`);
      continue;
    }
    if (!patronTipo.test(c.tipo)) {
      p.push(`${TABLA}.${nombre} EXISTE PERO es ${c.tipo}`);
    }
    if (c.aceptaNull !== aceptaNull) {
      p.push(`${TABLA}.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`);
    }
    if ((c.default ?? null) !== def) {
      p.push(`${TABLA}.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`);
    }
  }

  const exacto = (lista: string[], nombre: string, esperado: string, que: string) => {
    const linea = lista.find((x) => x.startsWith(`${nombre}: `));
    if (!linea) {
      p.push(`falta ${que} ${nombre}`);
      return;
    }
    const real = linea.slice(nombre.length + 2);
    if (real !== esperado) {
      p.push(`${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`);
    }
  };

  for (const [n, d] of CHECKS) exacto(e.ownership.checks, n, d, "el CHECK");
  for (const [n, d] of FKS) exacto(e.ownership.fks, n, d, "el FK");
  for (const [n, d] of INDICES) exacto(e.ownership.indices, n, d, "el índice");

  // La columna de la pieza C.
  const ce = e.artistCollectives.columnas.find((x) => x.nombre === "can_edit");
  if (!ce) p.push("falta artist_collectives.can_edit");
  else {
    if (!/boolean/i.test(ce.tipo)) p.push(`artist_collectives.can_edit EXISTE PERO es ${ce.tipo}`);
    if (ce.aceptaNull) p.push("artist_collectives.can_edit acepta NULL y tiene que ser NOT NULL");
    if (ce.default !== "false") {
      p.push(`artist_collectives.can_edit tiene default ${ce.default ?? "ninguno"} y se esperaba false`);
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
    if (!existe) return { columnas: [], checks: [], fks: [], indices: [] };
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
    const [existe] = await sql`SELECT 1 FROM pg_class WHERE relname = ${TABLA}`;
    const ownership = await formaDe(TABLA);
    const artistCollectives = await formaDe("artist_collectives");

    /**
     * Los conteos son la prueba de que no se tocó ningún dato: TOTALES,
     * no solo de lo nuevo. En setup-moderation el guard comparaba dos
     * ceros sintéticos en la primera corrida, y una medición que no
     * puede cambiar no prueba nada.
     */
    const [ac] = await sql`SELECT COUNT(*)::int AS n FROM artist_collectives`;
    const [co] = await sql`SELECT COUNT(*)::int AS n FROM collectives`;
    const conteos: Record<string, number> = {
      filas_artist_collectives: ac.n as number,
      filas_collectives: co.n as number,
      filas_ownership: 0,
      puede_editar_en_true: 0,
    };
    if (existe) {
      const [o] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
      conteos.filas_ownership = o.n as number;
    }
    if (artistCollectives.columnas.some((c) => c.nombre === "can_edit")) {
      const [e] = await sql`SELECT COUNT(*)::int AS n FROM artist_collectives WHERE can_edit`;
      conteos.puede_editar_en_true = e.n as number;
    }
    return { existeTabla: Boolean(existe), ownership, artistCollectives, conteos };
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
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push(
        "SIN BACKFILL: el registro arranca VACÍO. No se inventan filas para los colectivos que ya tienen dueño, porque no se sabe cuándo ni cómo lo pasaron a ser."
      );
      log.push(
        "can_edit entra en false para todas las membresías, que es exactamente lo que pasa hoy: solo el dueño edita."
      );
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. Los de filas no pueden cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /* ============ LA TABLA ============
     * CREATE TABLE IF NOT EXISTS compara por NOMBRE y se saltea entero
     * si ya hay algo llamado así con otra forma. Por eso después van los
     * ADD COLUMN IF NOT EXISTS uno por uno, y los constraints e índices
     * por SWAP: cada corrida RE-AFIRMA la forma en vez de confiar en que
     * la primera la dejó bien.
     */
    await sql(`
      CREATE TABLE IF NOT EXISTS ${TABLA} (
        id SERIAL PRIMARY KEY,
        collective_slug TEXT NOT NULL,
        kind TEXT NOT NULL,
        from_email TEXT,
        to_email TEXT,
        note TEXT,
        offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at TIMESTAMPTZ,
        declined_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )
    `);
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS collective_slug TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS kind TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS from_email TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS to_email TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS note TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ NOT NULL DEFAULT now()`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`),
    ]);

    /* ============ LA COLUMNA DE LA PIEZA C ============ */
    await sql(
      `ALTER TABLE artist_collectives ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT false`
    );

    /* ============ CONSTRAINTS E ÍNDICES, POR SWAP ============
     * DROP IF EXISTS + ADD desnudo, los dos en una transacción. Sin la
     * transacción hay una ventana real de un round-trip sin guarda,
     * porque cada sql del driver HTTP de Neon es su propio request. Y si
     * una fila violara el ADD, tira check_violation ruidosamente y la
     * transacción deja la guarda vieja en su lugar.
     */
    for (const [nombre, definicion] of CHECKS) {
      await sql.transaction([
        sql(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${nombre}`),
        sql(`ALTER TABLE ${TABLA} ADD CONSTRAINT ${nombre} ${definicion}`),
      ]);
    }
    for (const [nombre, definicion] of FKS) {
      await sql.transaction([
        sql(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${nombre}`),
        sql(`ALTER TABLE ${TABLA} ADD CONSTRAINT ${nombre} ${definicion}`),
      ]);
    }
    for (const [nombre, definicion] of INDICES) {
      await sql.transaction([sql(`DROP INDEX IF EXISTS ${nombre}`), sql(definicion)]);
    }

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? `VERIFICADO: ${TABLA} con sus 10 columnas, 3 CHECK, 3 FK y 2 índices, y artist_collectives.can_edit, con la forma esperada.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = ["filas_artist_collectives", "filas_collectives"].filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(`ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe datos.`);
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
