/**
 * MIGRATION — la bandeja de salida de correo (§8).
 *
 *   /api/setup-mail-outbox?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-mail-outbox?secret=YOUR_SECRET
 *
 * UNA TABLA NUEVA Y NADA MÁS. Sin backfill, sin tocar nada existente.
 *
 * ============================================================
 * UNA TABLA Y NO EL LOG
 * ============================================================
 *
 * HOTU todavía no tiene dominio propio, así que no puede mandar un solo
 * mail: sin dominio no hay SPF ni DKIM, y sin eso Gmail manda a spam o
 * rechaza. Pero los avisos hacen falta YA —el flujo de reclamo los
 * necesita— así que el transporte registra en vez de enviar.
 *
 * Registrar en el LOG habría sido más barato y es peor por dos razones
 * medidas, no supuestas:
 *
 *   - En Vercel el log es efímero y no se consulta desde el sitio. Un
 *     aviso que nadie puede mirar es un aviso que no existe.
 *   - Esta tabla ES la bandeja de salida de verdad el día que haya
 *     proveedor. La misma fila pasa de 'registrado' a 'enviado' o
 *     'fallo'. No hay que tirar nada ni migrar nada.
 *
 * ============================================================
 * `para` NO TIENE FK. A PROPÓSITO, Y POR DOS RAZONES DISTINTAS
 * ============================================================
 *
 *   - No siempre es una cuenta. Uno de los avisos del reclamo va al
 *     `contact_email` del perfil, que es un mail público y puede no
 *     corresponder a ninguna fila de user_profiles.
 *   - Y tiene que sobrevivir a la cuenta. Si alguien se borra, lo que se
 *     le avisó sigue habiendo pasado. Mismo criterio que audit_log y que
 *     account_removals.
 *
 * ============================================================
 * 'suprimido' EXIGE MOTIVO, Y ESE ES EL PUNTO DE LA TABLA
 * ============================================================
 *
 * La guarda de lib/mail.ts nunca escribe a @perfil.hotu.local ni a
 * @test.hotu.local: son dominios inexistentes y cada envío sería un hard
 * bounce, que es la forma más rápida de quemar un dominio nuevo.
 *
 * Pero "no se mandó" sin decir por qué es indistinguible de un bug. Así
 * que una fila 'suprimido' SIN motivo la rechaza la base. Es la misma
 * forma que el rechazo-con-motivo de artists: un CHECK que compara dos
 * columnas de la misma fila, que es lo único que un CHECK puede hacer.
 *
 * `estado` entra SIN default a propósito: lo escribe siempre el
 * transporte. Un default acá sería una fila que nació sin que nadie
 * decidiera en qué estado está.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "mail_outbox";

/** Espacio, tab, CR, LF y espacio duro, con escapes y no literales. */
const BLANCOS = " \t\r\n\u00A0";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["id", /integer/i, false, `nextval('${TABLA}_id_seq'::regclass)`],
  ["tipo", /text/i, false, null],
  ["para", /text/i, false, null],
  ["asunto", /text/i, false, null],
  ["cuerpo", /text/i, false, null],
  ["estado", /text/i, false, null],
  ["motivo", /text/i, true, null],
  ["referencia", /text/i, true, null],
  ["creado_en", /timestamp with time zone/i, false, "now()"],
  ["enviado_en", /timestamp with time zone/i, true, null],
];

const CHECKS: Array<[string, string]> = [
  [
    `${TABLA}_estado_check`,
    "CHECK ((estado = ANY (ARRAY['registrado'::text, 'enviado'::text, 'suprimido'::text, 'fallo'::text])))",
  ],
  [`${TABLA}_para_check`, `CHECK ((btrim(para, '${BLANCOS}'::text) <> ''::text))`],
  [`${TABLA}_tipo_check`, `CHECK ((btrim(tipo, '${BLANCOS}'::text) <> ''::text))`],
  /**
   * Ni 'suprimido' ni 'fallo' se pueden guardar sin decir por qué. Los
   * dos son "no llegó", y un "no llegó" sin causa es indistinguible de
   * un bug.
   *
   * OJO CON LOS PARÉNTESIS, y está MEDIDO contra Postgres, no supuesto:
   * pg_get_constraintdef envuelve TODA la expresión en un par MÁS del que
   * uno escribe. Con dos niveles acá el ADD funciona igual, pero la
   * comparación exacta falla y `verificado` da false sin que nada esté
   * mal.
   *
   * El migration-reviewer marcó esta línea sospechando del constructo
   * NOT (x = ANY (...)). Ese constructo vuelve PERFECTO —el CHECK
   * equivalente de profile_ownership usa el mismo y sale idéntico—; lo que
   * faltaba era el paréntesis. Línea correcta, causa equivocada.
   */
  [
    `${TABLA}_motivo_check`,
    `CHECK (((NOT (estado = ANY (ARRAY['suprimido'::text, 'fallo'::text]))) OR ((motivo IS NOT NULL) AND (btrim(motivo, '${BLANCOS}'::text) <> ''::text))))`,
  ],
];

const INDICES: Array<[string, string]> = [
  [
    `${TABLA}_creado_en_idx`,
    `CREATE INDEX ${TABLA}_creado_en_idx ON public.${TABLA} USING btree (creado_en DESC)`,
  ],
  /**
   * Parcial sobre lo que todavía no salió: el día que haya proveedor, el
   * reenvío lee solo eso. Un índice sobre todos los estados guardaría
   * miles de 'enviado' que nadie consulta.
   */
  [
    `${TABLA}_pendientes_idx`,
    `CREATE INDEX ${TABLA}_pendientes_idx ON public.${TABLA} USING btree (creado_en) WHERE (estado = 'registrado'::text)`,
  ],
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { existeTabla: boolean; outbox: Forma; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (!e.existeTabla) return { ok: false, problemas: [`falta la tabla ${TABLA}`] };

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = e.outbox.columnas.find((x) => x.nombre === nombre);
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
  for (const [n, d] of CHECKS) exacto(e.outbox.checks, n, d, "el CHECK");
  for (const [n, d] of INDICES) exacto(e.outbox.indices, n, d, "el índice");

  /**
   * Que NO haya FK también es forma. Si alguien "corrige" la tabla
   * poniéndole el FK que la convención pide contra user_profiles, dos
   * cosas se rompen: los avisos a un contact_email que no es cuenta
   * dejan de poder insertarse, y el historial se borra con la cuenta.
   */
  if (e.outbox.fks.length > 0) {
    p.push(
      `${TABLA} tiene FK y no debe tener ninguno (${e.outbox.fks.join("; ")}). ` +
        "`para` no siempre es una cuenta, y el registro sobrevive a la cuenta."
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
    const outbox = await formaDe(TABLA);
    const [u] = await sql`SELECT COUNT(*)::int AS n FROM user_profiles`;
    const conteos: Record<string, number> = { filas_user_profiles: u.n as number, filas_outbox: 0 };
    if (existe) {
      const [o] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
      conteos.filas_outbox = o.n as number;
    }
    return { existeTabla: Boolean(existe), outbox, conteos };
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
      log.push("SIN BACKFILL: la bandeja arranca VACÍA. No hay avisos viejos que inventar.");
      log.push("SIN FK: `para` no siempre es una cuenta, y el registro sobrevive a la cuenta.");
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
        tipo TEXT NOT NULL,
        para TEXT NOT NULL,
        asunto TEXT NOT NULL,
        cuerpo TEXT NOT NULL,
        estado TEXT NOT NULL,
        motivo TEXT,
        referencia TEXT,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        enviado_en TIMESTAMPTZ
      )
    `);

    /**
     * Los ADD COLUMN van sin NOT NULL y en una transacción: solo actúan
     * si alguien dejó la tabla a medias, y un ADD COLUMN NOT NULL sin
     * default sobre una tabla con filas falla. El NOT NULL definitivo lo
     * afirma el CREATE TABLE, y si no quedó, verificarForma lo canta.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS tipo TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS para TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS asunto TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS cuerpo TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS estado TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS motivo TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS referencia TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now()`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS enviado_en TIMESTAMPTZ`),
    ]);

    /* CHECKS E ÍNDICES POR SWAP: DROP IF EXISTS + ADD desnudo, juntos en
     * una transacción. Sin ella hay una ventana de un round-trip sin
     * guarda, y si una fila violara el ADD, tira check_violation
     * ruidosamente y la transacción deja la guarda vieja en su lugar. */
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
        ? `VERIFICADO: ${TABLA} con sus 10 columnas, 4 CHECK, 2 índices y CERO FK, con la forma esperada.`
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no escribe ni borra una sola fila.`
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
