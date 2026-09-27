/**
 * MIGRATION — edit_log: quién editó qué en un colectivo (§8 fase 2).
 *
 *   /api/setup-edit-log?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-edit-log?secret=YOUR_SECRET
 *
 * UNA TABLA NUEVA Y NADA MÁS. Sin backfill: no hay historial de ediciones
 * que inventar, porque hasta hoy solo editaba el dueño y no se registraba.
 *
 * ============================================================
 * POR QUÉ HACE FALTA, Y POR QUÉ AHORA
 * ============================================================
 *
 * Hasta la fase 2, un colectivo lo editaba solo su dueño: "quién lo hizo" era
 * una pregunta con una sola respuesta posible y no valía la pena guardarla.
 *
 * La fase 2 le da permiso de edición a los RESIDENTES. Con varias manos sobre
 * el mismo perfil, "quién cambió esto" pasa a ser una pregunta real — y la
 * condición explícita con la que se concedió el permiso fue que cada edición
 * quedara registrada con su autor. Así que esta tabla no es telemetría: es
 * parte del permiso.
 *
 * Y registra TAMBIÉN las ediciones del SUPER_ADMIN, que sigue entrando por
 * canEditCollective. Un moderador que edita el colectivo de otro deja el
 * mismo rastro que un residente; lo que NO hace es aparecer en la lista
 * pública de editores, porque no es parte del colectivo.
 *
 * ============================================================
 * SE GUARDAN NOMBRES DE CAMPO, NO VALORES. A PROPÓSITO.
 * ============================================================
 *
 * `detalle` lleva QUÉ campos cambiaron, no qué decían antes ni qué dicen
 * ahora. Guardar los valores convertiría esto en una copia del contenido del
 * sitio, con dos costos: crece sin techo, y hereda el problema de retención
 * que mail_outbox ya tiene anotado en deuda — texto escrito por personas que
 * hay que decidir cuánto tiempo se conserva.
 *
 * Para "quién tocó la bio el martes" alcanza el nombre del campo. Para "qué
 * decía antes" hace falta versionado, que es otra pieza y otra decisión.
 *
 * ============================================================
 * SIN FK, POR LAS DOS RAZONES DE SIEMPRE
 * ============================================================
 *
 * actor_email y collective_slug nombran cosas que pueden desaparecer. Un FK
 * las borraría en cascada o impediría borrarlas, y las dos convierten el
 * registro en nada justo cuando empieza a importar: lo que se quiere saber
 * después es precisamente quién editó un colectivo que ya no está, o qué hizo
 * una cuenta que se fue.
 *
 * Mismo criterio que account_removals, mail_outbox y audit_log. Y la
 * verificación comprueba que la lista de FK esté VACÍA, igual que comprueba
 * lo que sí tiene que estar.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "edit_log";

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["id", /integer/i, false, `nextval('${TABLA}_id_seq'::regclass)`],
  ["actor_email", /text/i, false, null],
  ["actor_rol", /text/i, false, null],
  ["collective_slug", /text/i, false, null],
  ["entidad", /text/i, false, null],
  ["entidad_id", /text/i, false, null],
  ["accion", /text/i, false, null],
  ["detalle", /jsonb/i, true, null],
  ["creado_en", /timestamp with time zone/i, false, "now()"],
];

const CHECKS: Array<[string, string]> = [
  [
    `${TABLA}_actor_rol_check`,
    "CHECK ((actor_rol = ANY (ARRAY['dueno'::text, 'residente'::text, 'super_admin'::text])))",
  ],
  [
    `${TABLA}_accion_check`,
    "CHECK ((accion = ANY (ARRAY['crear'::text, 'editar'::text, 'borrar'::text])))",
  ],
  [
    `${TABLA}_entidad_check`,
    "CHECK ((entidad = ANY (ARRAY['collective'::text, 'event'::text, 'news'::text, 'set'::text, 'track'::text, 'genero'::text, 'imagen'::text])))",
  ],
  [`${TABLA}_actor_check`, `CHECK ((btrim(actor_email, '${BLANCOS}'::text) <> ''::text))`],
  [`${TABLA}_entidad_id_check`, `CHECK ((btrim(entidad_id, '${BLANCOS}'::text) <> ''::text))`],
  /**
   * collective_slug lleva su propia guarda porque es el único TEXT que no la
   * tiene de rebote: entidad y accion son listas cerradas y '' no está en
   * ninguna, así que el = ANY ya las cubre. Este no, y una fila con el slug
   * vacío no la rechazaría nada — sería un registro que dice que alguien editó
   * algo, sin decir qué.
   */
  [
    `${TABLA}_colectivo_check`,
    `CHECK ((btrim(collective_slug, '${BLANCOS}'::text) <> ''::text))`,
  ],
];

const INDICES: Array<[string, string]> = [
  /** La consulta que importa: el historial de UN colectivo, lo más nuevo primero. */
  [
    `${TABLA}_colectivo_idx`,
    `CREATE INDEX ${TABLA}_colectivo_idx ON public.${TABLA} USING btree (collective_slug, creado_en DESC)`,
  ],
  /** Y la otra: todo lo que hizo una cuenta, para revisarla. */
  [
    `${TABLA}_actor_idx`,
    `CREATE INDEX ${TABLA}_actor_idx ON public.${TABLA} USING btree (actor_email, creado_en DESC)`,
  ],
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { existeTabla: boolean; log: Forma; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (!e.existeTabla) return { ok: false, problemas: [`falta la tabla ${TABLA}`] };

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = e.log.columnas.find((x) => x.nombre === nombre);
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
  for (const [n, d] of CHECKS) exacto(e.log.checks, n, d, "el CHECK");
  for (const [n, d] of INDICES) exacto(e.log.indices, n, d, "el índice");

  if (e.log.fks.length > 0) {
    p.push(
      `${TABLA} tiene FK y no debe tener ninguno (${e.log.fks.join("; ")}). ` +
        "Lo que se quiere saber después es quién editó un colectivo que ya no está."
    );
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
    const forma = await formaDe(TABLA);
    const [ac] = await sql`SELECT COUNT(*)::int AS n FROM artist_collectives`;
    const conteos: Record<string, number> = { filas_artist_collectives: ac.n as number, filas_log: 0 };
    if (existe) {
      const [l] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
      conteos.filas_log = l.n as number;
    }
    return { existeTabla: Boolean(existe), log: forma, conteos };
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
      log.push("SIN BACKFILL: el registro arranca VACÍO. Hasta hoy solo editaba el dueño.");
      log.push("SIN FK: tiene que poder decir quién editó un colectivo que ya no existe.");
      log.push("`detalle` guarda NOMBRES de campo, nunca valores: esto no es una copia del contenido.");
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. Ninguno puede cambiar.`);
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
        actor_email TEXT NOT NULL,
        actor_rol TEXT NOT NULL,
        collective_slug TEXT NOT NULL,
        entidad TEXT NOT NULL,
        entidad_id TEXT NOT NULL,
        accion TEXT NOT NULL,
        detalle JSONB,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    /**
     * Los ADD COLUMN van sin NOT NULL y en una transacción: solo actúan si
     * alguien dejó la tabla a medias, y un ADD COLUMN NOT NULL sin default
     * sobre una tabla con filas falla. El NOT NULL definitivo lo afirma el
     * CREATE TABLE, y si no quedó, verificarForma lo canta.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS actor_email TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS actor_rol TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS collective_slug TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS entidad TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS entidad_id TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS accion TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS detalle JSONB`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now()`),
    ]);

    for (const [nombre, definicion] of CHECKS) {
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
        ? `VERIFICADO: ${TABLA} con sus ${COLUMNAS.length} columnas, ${CHECKS.length} CHECK, ` +
          `${INDICES.length} índices y CERO FK, con la forma esperada.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(`ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe ni borra filas.`);
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
