/**
 * MIGRATION — profile_ownership: la historia de quién administra un perfil.
 *
 *   /api/setup-profile-ownership?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-profile-ownership?secret=YOUR_SECRET
 *
 * TABLA NUEVA. NO TOCA collective_ownership, QUE QUEDA CONGELADA.
 *
 * ============================================================
 * POR QUÉ NO ES UN RENAME
 * ============================================================
 *
 * collective_ownership no sirve para un perfil de artista:
 * collective_slug es NOT NULL con FK a collectives(slug). Y el flujo de
 * reclamo tiene que cubrir los dos — un perfil de DJ desamparado se
 * reclama igual que un colectivo.
 *
 * Renombrar la tabla rompería producción en el instante de la migración:
 * el código desplegado lee collective_ownership. Se evaluó una vista con
 * el nombre viejo —en Postgres una vista simple es escribible, así que
 * habría funcionado— y se descartó: sería un mecanismo ingenioso
 * interceptando el camino de la PROPIEDAD de un perfil, y lo ingenioso es
 * lo que muerde. Acá no hay nada que interceptar.
 *
 * Así que el patrón es el que el repo ya usa para los tres jsonb y para
 * status_membership, con su regla escrita —primero dejar de escribir,
 * después borrar— aplicado a una tabla en vez de a una columna:
 *
 *   1. Esta migración crea la nueva. La vieja sigue intacta, así que
 *      producción no se rompe: sigue leyendo la que lee.
 *   2. Se despliega el código que usa la nueva.
 *   3. Una migración mínima copia lo que hubiera caído en la vieja
 *      durante la ventana, contándolo. Se espera 0 —la cesión se
 *      desplegó el mismo día y nadie la usó, y main tiene 0 filas
 *      medidas— y eso lo convierte en medición y no en suposición.
 *   4. Borrar la vieja: otra migración, otro día.
 *
 * ============================================================
 * QUÉ TIENE DE NUEVO, ADEMÁS DE SERVIR PARA LOS DOS
 * ============================================================
 *
 * artist_slug — el perfil de DJ. Exactamente UNO de los dos slugs va
 *   lleno, y eso lo garantiza un CHECK con num_nonnulls, que dice lo que
 *   se quiere decir en vez de dos pares de comparaciones.
 *
 * decision_note y decided_by — el motivo de quien DECIDE y quién fue.
 *   `note` ya existía y es lo que escribe quien INICIA: el reclamante
 *   explicando por qué el perfil es suyo, o el moderador justificando un
 *   traspaso. Son dos textos de dos personas distintas en momentos
 *   distintos, y meterlos en una sola columna hace que el rechazo pise la
 *   explicación que el moderador necesitaba para decidir.
 *
 * Y un agujero que esto cierra: reasignarDueno NO ESCRIBÍA NADA. El
 * kind='moderacion' existía en el CHECK desde la migración anterior, con
 * su exigencia de motivo, y ningún write path lo usaba. La acción más
 * poderosa del panel —mover la propiedad de un perfil— no quedaba
 * auditada en ninguna parte.
 *
 * ============================================================
 * UN RECHAZO SIN MOTIVO NO SE PUEDE GUARDAR
 * ============================================================
 *
 * Es la regla del repo —el motivo es lo único que recibe la persona del
 * otro lado— y acá sí la puede hacer cumplir la base, porque compara dos
 * columnas de la MISMA fila. Un reclamo rechazado sin decision_note es un
 * DJ que no sabe qué corregir, y Postgres lo rechaza.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "profile_ownership";

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["id", /integer/i, false, `nextval('${TABLA}_id_seq'::regclass)`],
  ["collective_slug", /text/i, true, null],
  ["artist_slug", /text/i, true, null],
  ["kind", /text/i, false, null],
  ["from_email", /text/i, true, null],
  ["to_email", /text/i, true, null],
  ["note", /text/i, true, null],
  ["decision_note", /text/i, true, null],
  ["decided_by", /text/i, true, null],
  ["offered_at", /timestamp with time zone/i, false, "now()"],
  ["accepted_at", /timestamp with time zone/i, true, null],
  ["declined_at", /timestamp with time zone/i, true, null],
  ["revoked_at", /timestamp with time zone/i, true, null],
];

const CHECKS: Array<[string, string]> = [
  [
    `${TABLA}_kind_check`,
    "CHECK ((kind = ANY (ARRAY['cesion'::text, 'desamparo'::text, 'reclamo'::text, 'moderacion'::text])))",
  ],
  /** Exactamente UN perfil: o colectivo, o artista. Nunca los dos, nunca ninguno. */
  [`${TABLA}_un_perfil_check`, "CHECK ((num_nonnulls(collective_slug, artist_slug) = 1))"],
  [
    `${TABLA}_respuesta_unica_check`,
    "CHECK ((num_nonnulls(accepted_at, declined_at, revoked_at) <= 1))",
  ],
  /** Quien INICIA un reclamo o un traspaso tiene que explicarse. */
  [
    `${TABLA}_motivo_check`,
    `CHECK (((NOT (kind = ANY (ARRAY['moderacion'::text, 'reclamo'::text]))) OR ((note IS NOT NULL) AND (btrim(note, '${BLANCOS}'::text) <> ''::text))))`,
  ],
  /** Y quien RECHAZA también. Es lo único que recibe el otro. */
  [
    `${TABLA}_rechazo_con_motivo_check`,
    `CHECK (((declined_at IS NULL) OR ((decision_note IS NOT NULL) AND (btrim(decision_note, '${BLANCOS}'::text) <> ''::text))))`,
  ],
];

const FKS: Array<[string, string]> = [
  [
    `${TABLA}_collective_slug_fkey`,
    "FOREIGN KEY (collective_slug) REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE",
  ],
  [
    `${TABLA}_artist_slug_fkey`,
    "FOREIGN KEY (artist_slug) REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE",
  ],
  [
    `${TABLA}_from_email_fkey`,
    "FOREIGN KEY (from_email) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
  ],
  [
    `${TABLA}_to_email_fkey`,
    "FOREIGN KEY (to_email) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
  ],
  [
    `${TABLA}_decided_by_fkey`,
    "FOREIGN KEY (decided_by) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
  ],
];

/**
 * El predicado de "sigue abierta" se repite en varios índices. Se escribe
 * una sola vez para que no se desincronicen: un índice único con un
 * predicado distinto del resto deja de proteger lo que cree proteger.
 *
 * `to_email IS NOT NULL` va en los de cesión porque una cesión cuyo
 * destinatario borró su cuenta queda con to_email en NULL y ya no espera
 * ninguna respuesta que alguien pueda dar. Sin eso trababa el colectivo
 * para siempre — el modo de falla que el reviewer encontró en la tabla
 * anterior.
 */
const ABIERTA = "(accepted_at IS NULL) AND (declined_at IS NULL) AND (revoked_at IS NULL)";

const INDICES: Array<[string, string]> = [
  [
    `${TABLA}_una_cesion_colectivo_idx`,
    `CREATE UNIQUE INDEX ${TABLA}_una_cesion_colectivo_idx ON public.${TABLA} USING btree (collective_slug) WHERE ((kind = 'cesion'::text) AND ${ABIERTA} AND (to_email IS NOT NULL))`,
  ],
  [
    `${TABLA}_una_cesion_artista_idx`,
    `CREATE UNIQUE INDEX ${TABLA}_una_cesion_artista_idx ON public.${TABLA} USING btree (artist_slug) WHERE ((kind = 'cesion'::text) AND ${ABIERTA} AND (to_email IS NOT NULL))`,
  ],
  /**
   * UN reclamo abierto por persona y por perfil. No uno por perfil:
   * dos personas distintas pueden reclamar el mismo y el moderador elige.
   * Lo que esto impide es que la misma cuenta mande veinte.
   */
  [
    `${TABLA}_un_reclamo_colectivo_idx`,
    `CREATE UNIQUE INDEX ${TABLA}_un_reclamo_colectivo_idx ON public.${TABLA} USING btree (collective_slug, to_email) WHERE ((kind = 'reclamo'::text) AND ${ABIERTA})`,
  ],
  [
    `${TABLA}_un_reclamo_artista_idx`,
    `CREATE UNIQUE INDEX ${TABLA}_un_reclamo_artista_idx ON public.${TABLA} USING btree (artist_slug, to_email) WHERE ((kind = 'reclamo'::text) AND ${ABIERTA})`,
  ],
  [
    `${TABLA}_bandeja_idx`,
    `CREATE INDEX ${TABLA}_bandeja_idx ON public.${TABLA} USING btree (to_email) WHERE (${ABIERTA})`,
  ],
  [
    `${TABLA}_cola_reclamos_idx`,
    `CREATE INDEX ${TABLA}_cola_reclamos_idx ON public.${TABLA} USING btree (offered_at) WHERE ((kind = 'reclamo'::text) AND ${ABIERTA})`,
  ],
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { existeTabla: boolean; nueva: Forma; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (!e.existeTabla) return { ok: false, problemas: [`falta la tabla ${TABLA}`] };

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = e.nueva.columnas.find((x) => x.nombre === nombre);
    if (!c) {
      p.push(`falta ${TABLA}.${nombre}`);
      continue;
    }
    if (!patronTipo.test(c.tipo)) p.push(`${TABLA}.${nombre} EXISTE PERO es ${c.tipo}`);
    if (c.aceptaNull !== aceptaNull) {
      p.push(
        `${TABLA}.${nombre} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"} y se esperaba lo contrario`
      );
    }
    if ((c.default ?? null) !== def) {
      p.push(
        `${TABLA}.${nombre} tiene default ${c.default ?? "ninguno"} y se esperaba ${def ?? "ninguno"}`
      );
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
      p.push(
        `${que} ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
      );
    }
  };
  for (const [n, d] of CHECKS) exacto(e.nueva.checks, n, d, "el CHECK");
  for (const [n, d] of FKS) exacto(e.nueva.fks, n, d, "el FK");
  for (const [n, d] of INDICES) exacto(e.nueva.indices, n, d, "el índice");

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
    const nueva = await formaDe(TABLA);

    /**
     * Se cuenta la VIEJA además de la nueva. Es la medición que sostiene
     * todo el plan: si collective_ownership no está en 0, el paso 3 tiene
     * filas que copiar y hay que mirarlas antes de seguir.
     */
    const conteos: Record<string, number> = { filas_nueva: 0, filas_vieja: 0, abiertas_vieja: 0 };
    if (existe) {
      const [n] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
      conteos.filas_nueva = n.n as number;
    }
    const [vieja] = await sql`SELECT 1 FROM pg_class WHERE relname = 'collective_ownership'`;
    if (vieja) {
      const [v] = await sql`SELECT COUNT(*)::int AS n FROM collective_ownership`;
      conteos.filas_vieja = v.n as number;
      const [a] = await sql`
        SELECT COUNT(*)::int AS n FROM collective_ownership
        WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
      `;
      conteos.abiertas_vieja = a.n as number;
    }
    return { existeTabla: Boolean(existe), nueva, conteos };
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
      log.push("NO TOCA collective_ownership: queda intacta y congelada. Producción sigue leyéndola.");
      log.push("SIN BACKFILL: la tabla nueva arranca VACÍA. No se copia nada acá.");
      log.push(
        `collective_ownership tiene ${antes.conteos.filas_vieja} fila(s), ${antes.conteos.abiertas_vieja} abierta(s). ` +
          "Si no es 0, PARÁ: hay historia que el paso 3 tiene que copiar y conviene mirarla antes."
      );
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    await sql(`
      CREATE TABLE IF NOT EXISTS ${TABLA} (
        id SERIAL PRIMARY KEY,
        collective_slug TEXT,
        artist_slug TEXT,
        kind TEXT NOT NULL,
        from_email TEXT,
        to_email TEXT,
        note TEXT,
        decision_note TEXT,
        decided_by TEXT,
        offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at TIMESTAMPTZ,
        declined_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )
    `);

    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS collective_slug TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS artist_slug TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS kind TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS from_email TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS to_email TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS note TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS decision_note TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS decided_by TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ NOT NULL DEFAULT now()`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`),
    ]);

    /* CHECKS, FKS E ÍNDICES POR SWAP. DROP IF EXISTS + ADD desnudo, los
     * dos en una transacción: sin ella hay una ventana de un round-trip
     * sin guarda, y si el ADD falla por una fila vieja tira
     * check_violation —que el envoltorio DO/duplicate_object NO atrapa—
     * dejando la tabla sin guarda. Adentro de la transacción el ADD va
     * desnudo: después del DROP no queda nada con ese nombre. */
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
        ? `VERIFICADO: ${TABLA} con sus 13 columnas, 5 CHECK, 5 FK y 6 índices, con la forma esperada.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    if (despues.conteos.filas_vieja !== antes.conteos.filas_vieja) {
      log.push(
        `ATENCIÓN: collective_ownership pasó de ${antes.conteos.filas_vieja} a ${despues.conteos.filas_vieja} filas. ` +
          "Esta migración no la toca: algo le escribió en el medio, y eso es lo que el paso 3 tiene que copiar."
      );
    } else {
      log.push(
        `collective_ownership intacta en ${despues.conteos.filas_vieja} fila(s). ` +
          `${TABLA} arranca con ${despues.conteos.filas_nueva}.`
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok && despues.conteos.filas_vieja === antes.conteos.filas_vieja,
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
