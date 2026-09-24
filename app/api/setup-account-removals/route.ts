/**
 * MIGRATION — el registro de cuentas eliminadas (§8).
 *
 *   /api/setup-account-removals?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-account-removals?secret=YOUR_SECRET
 *
 * UNA TABLA NUEVA Y NADA MÁS. No toca ninguna tabla existente, no tiene
 * backfill y no escribe una sola fila: el registro arranca vacío porque
 * hasta hoy no se borró ninguna cuenta, y llenarlo con suposiciones
 * sería inventar un historial.
 *
 * ============================================================
 * PARA QUÉ, Y POR QUÉ NO ALCANZABA audit_log
 * ============================================================
 *
 * Eliminar una cuenta es la única acción de moderación que NO se puede
 * deshacer. El ban se levanta, la censura se levanta, un traspaso se
 * vuelve a traspasar. Esto no. Entonces lo único que queda después es el
 * registro, y si el registro no dice QUÉ se llevó puesto, la pregunta
 * "¿esta boleta existió?" no tiene respuesta.
 *
 * audit_log tiene (email, action, created_at) y nada más. Sirve para
 * "fulano editó su perfil"; no para "se borraron 3 pedidos por 240.000
 * COP y 2 boletas del evento 7". Meter eso en `action` como texto sería
 * un registro que nadie puede consultar.
 *
 * ============================================================
 * ESTA TABLA NO TIENE FK. A PROPÓSITO.
 * ============================================================
 *
 * email y removed_by nombran cuentas, y la convención del repo es que
 * eso lleva FK contra user_profiles. Acá NO, por dos razones distintas:
 *
 *   email      — es el de la cuenta que se acaba de borrar. Un FK contra
 *                user_profiles haría que la fila no se pueda insertar
 *                (RESTRICT) o que se borre sola con la cuenta (CASCADE).
 *                Las dos convierten el registro en nada justo cuando
 *                empieza a importar.
 *   removed_by — el moderador también puede irse algún día, y un
 *                SET NULL dejaría un borrado sin responsable.
 *
 * Es el mismo criterio que audit_log, que tampoco tiene FK. Un registro
 * histórico guarda lo que pasó, no punteros a lo que todavía existe.
 *
 * ============================================================
 * plan Y measured SON DOS COSAS DISTINTAS
 * ============================================================
 *
 * plan     — lo que la vista previa dijo que iba a borrar, escrito ANTES
 *            y en la misma transacción que el borrado.
 * measured — lo que de verdad se borró, contado con RETURNING y escrito
 *            DESPUÉS de que la transacción commitea.
 *
 * measured es NULLABLE, y un NULL significa algo preciso: el borrado se
 * aplicó pero el conteo no llegó a escribirse. Es información, no un
 * hueco. Si fueran una sola columna, un fallo en el segundo paso dejaría
 * la fila diciendo el plan y pareciendo la medición.
 *
 * Y si los dos difieren, no es necesariamente un bug: puede ser una fila
 * que entró entre la vista previa y la confirmación. Eso también hay que
 * poder verlo.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "account_removals";

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["id", /integer/i, false, `nextval('${TABLA}_id_seq'::regclass)`],
  ["email", /text/i, false, null],
  ["removed_by", /text/i, false, null],
  ["mode", /text/i, false, null],
  ["note", /text/i, false, null],
  ["plan", /jsonb/i, false, "'{}'::jsonb"],
  ["measured", /jsonb/i, true, null],
  ["removed_at", /timestamp with time zone/i, false, "now()"],
];

/**
 * Definiciones EXACTAS, medidas contra Postgres. Comparar la definición
 * entera y no subcadenas es la lección de setup-moderation: buscando
 * pedacitos, cinco de siete variantes falsas pasaban.
 */
const CHECKS: Array<[string, string]> = [
  [`${TABLA}_mode_check`, "CHECK ((mode = ANY (ARRAY['normal'::text, 'limpieza'::text])))"],
  [`${TABLA}_email_check`, `CHECK ((btrim(email, '${BLANCOS}'::text) <> ''::text))`],
  [`${TABLA}_note_check`, `CHECK ((btrim(note, '${BLANCOS}'::text) <> ''::text))`],
];

const INDICES: Array<[string, string]> = [
  [
    `${TABLA}_email_idx`,
    `CREATE INDEX ${TABLA}_email_idx ON public.${TABLA} USING btree (lower(email))`,
  ],
  [
    `${TABLA}_removed_at_idx`,
    `CREATE INDEX ${TABLA}_removed_at_idx ON public.${TABLA} USING btree (removed_at DESC)`,
  ],
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { existeTabla: boolean; removals: Forma; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  if (!e.existeTabla) return { ok: false, problemas: [`falta la tabla ${TABLA}`] };

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = e.removals.columnas.find((x) => x.nombre === nombre);
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

  for (const [n, d] of CHECKS) exacto(e.removals.checks, n, d, "el CHECK");
  for (const [n, d] of INDICES) exacto(e.removals.indices, n, d, "el índice");

  /**
   * Que NO haya FK también es forma, y se verifica igual que lo que sí
   * tiene que estar. Si alguien "corrige" la tabla agregándole el FK que
   * la convención pide, el registro deja de sobrevivir a lo que
   * registra, y eso tiene que fallar ruidosamente acá.
   */
  if (e.removals.fks.length > 0) {
    p.push(
      `${TABLA} tiene FK y no debe tener ninguno (${e.removals.fks.join("; ")}). ` +
        "Un registro histórico no apunta a filas que se pueden ir."
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
    const removals = await formaDe(TABLA);

    /**
     * Conteos TOTALES de lo que esta migración podría llegar a tocar si
     * estuviera mal escrita. Una medición que no puede cambiar no prueba
     * nada, así que no se cuenta solo la tabla nueva.
     */
    const [u] = await sql`SELECT COUNT(*)::int AS n FROM user_profiles`;
    const [o] = await sql`SELECT COUNT(*)::int AS n FROM orders`;
    const [t] = await sql`SELECT COUNT(*)::int AS n FROM tickets`;
    const conteos: Record<string, number> = {
      filas_user_profiles: u.n as number,
      filas_orders: o.n as number,
      filas_tickets: t.n as number,
      filas_account_removals: 0,
    };
    if (existe) {
      const [r] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
      conteos.filas_account_removals = r.n as number;
    }
    return { existeTabla: Boolean(existe), removals, conteos };
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
      log.push("SIN BACKFILL: el registro arranca VACÍO. No se inventa historial.");
      log.push("SIN FK: la fila tiene que sobrevivir a la cuenta que registra.");
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

    /* ============ LA TABLA ============
     * CREATE TABLE IF NOT EXISTS compara por NOMBRE y se saltea entero
     * si ya existe algo llamado así con otra forma. Por eso después van
     * los ADD COLUMN IF NOT EXISTS uno por uno, y los CHECK e índices
     * por SWAP: cada corrida RE-AFIRMA la forma.
     */
    await sql(`
      CREATE TABLE IF NOT EXISTS ${TABLA} (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        removed_by TEXT NOT NULL,
        mode TEXT NOT NULL,
        note TEXT NOT NULL,
        plan JSONB NOT NULL DEFAULT '{}'::jsonb,
        measured JSONB,
        removed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    /**
     * Los ADD COLUMN van en UNA transacción.
     *
     * Entre uno y el siguiente hay una ventana real —cada sql del driver
     * HTTP de Neon es su propio request— y acá encima varios entran
     * NOT NULL. Juntos, o ninguno.
     *
     * Van sin NOT NULL: un ADD COLUMN NOT NULL sin default sobre una
     * tabla que ya tenga filas falla, y estos solo actúan si alguien
     * dejó la tabla a medias. El NOT NULL definitivo lo afirma el
     * CREATE TABLE de arriba, y si no quedó, verificarForma lo canta.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS email TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS removed_by TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS mode TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS note TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '{}'::jsonb`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS measured JSONB`),
      sql(
        `ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ NOT NULL DEFAULT now()`
      ),
    ]);

    /* ============ CHECKS E ÍNDICES, POR SWAP ============
     * DROP IF EXISTS + ADD desnudo, los dos en una transacción. Sin la
     * transacción hay una ventana de un round-trip sin guarda; y si una
     * fila violara el ADD, tira check_violation ruidosamente y la
     * transacción deja la guarda vieja en su lugar.
     */
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
        ? `VERIFICADO: ${TABLA} con sus 8 columnas, 3 CHECK, 2 índices y CERO FK, con la forma esperada.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe ni borra una sola fila, ` +
          "así que en main lo más probable es tráfico legítimo entre las dos mediciones."
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
