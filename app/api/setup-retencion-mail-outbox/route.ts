/**
 * MIGRATION — la retención de mail_outbox: el contenido caduca, el registro no.
 *
 *   /api/setup-retencion-mail-outbox?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-retencion-mail-outbox?secret=YOUR_SECRET
 *
 *   asunto y cuerpo pasan a NULLABLE
 *   purgado_en TIMESTAMPTZ, nueva
 *   CHECK mail_outbox_purga_check, que ata las tres
 *
 * ============================================================
 * QUÉ SE DECIDIÓ, Y POR QUÉ NO ES UN BORRADO
 * ============================================================
 *
 * mail_outbox guarda direcciones de correo y EL TEXTO de lo que se le dijo a cada persona.
 * Es dato personal bajo la Ley 1581 de 2012, la misma razón por la que no se guarda la
 * cédula.
 *
 * Y las dos puntas sirven para algo distinto, que es lo que hace que borrar la fila sea la
 * respuesta equivocada:
 *
 *   el CUERPO es lo que permite contestar "¿qué le dijimos exactamente?" cuando alguien
 *   reclama que nunca le avisaron. A los 90 días ya no hace falta.
 *
 *   QUE SE MANDÓ, a quién y cuándo es lo que no puede caducar nunca: es la prueba de que el
 *   aviso salió. Borrar la fila entera se llevaría eso también, y a los 91 días HOTU no
 *   podría demostrar que avisó.
 *
 * Así que a los 90 días se VACÍA el contenido y se conserva el registro. Lo hace una ruta
 * de mantenimiento aparte; esta migración solo deja el schema en condiciones de permitirlo.
 *
 * ============================================================
 * purgado_en EXISTE PARA QUE UN NULL NO SEA AMBIGUO
 * ============================================================
 *
 * Sin esa columna, un cuerpo en NULL significaría dos cosas que no se pueden distinguir:
 * "se purgó a los 90 días" y "nunca tuvo cuerpo". La primera es un hecho con fecha; la
 * segunda sería un bug del que lo escribió.
 *
 * Es el mismo criterio que account_removals.measured, donde un NULL significa algo preciso
 * —se borró pero no se alcanzó a contar— en vez de ser un hueco.
 *
 * ============================================================
 * EL CHECK ATA LAS TRES, EN LOS DOS SENTIDOS
 * ============================================================
 *
 * No alcanza con permitir NULL: hay que impedir los estados intermedios, que son los que
 * aparecen cuando una purga se cae a mitad.
 *
 *   purgado_en IS NULL      -> asunto y cuerpo TIENEN que estar
 *   purgado_en IS NOT NULL  -> asunto y cuerpo TIENEN que ser NULL
 *
 * La primera mitad conserva la garantía que la tabla ya daba: una fila viva no puede quedar
 * sin asunto. La segunda impide que una purga a medias deje un cuerpo sin vaciar diciendo
 * que se purgó, que sería lo peor de los dos mundos — el dato sigue ahí y el registro
 * afirma que no.
 *
 * ============================================================
 * SIN BACKFILL, Y ACÁ LA REGLA DE LA GUARDA SÍ SE APLICARÍA
 * ============================================================
 *
 * No se purga nada en esta migración: purgado_en nace en NULL en todas las filas, que con
 * el CHECK significa "viva, con su contenido". Vaciar algo acá sería mezclar un cambio de
 * esquema con una purga de datos, y la purga tiene que poder correrse sola y contarse.
 *
 * Si alguna vez se agregara un backfill, la guarda NO podría ser purgado_en —porque es el
 * valor que la propia purga escribe— y habría que mirar creado_en. Queda dicho por si
 * alguien lo intenta.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "mail_outbox";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  // Las dos que cambian de forma: eran NOT NULL.
  ["asunto", /text/i, true, null],
  ["cuerpo", /text/i, true, null],
  ["purgado_en", /timestamp with time zone/i, true, null],
  // Y las que NO tienen que cambiar. Se verifican para que un ALTER de más se note.
  ["tipo", /text/i, false, null],
  ["para", /text/i, false, null],
  ["estado", /text/i, false, null],
  ["creado_en", /timestamp with time zone/i, false, "now()"],
];

const CHECKS: Array<[string, string]> = [
  [
    `${TABLA}_purga_check`,
    "CHECK ((((purgado_en IS NULL) AND (asunto IS NOT NULL) AND (cuerpo IS NOT NULL)) OR ((purgado_en IS NOT NULL) AND (asunto IS NULL) AND (cuerpo IS NULL))))",
  ],
];

/**
 * El índice de la purga: parcial sobre lo que TODAVÍA tiene contenido. Completo no serviría
 * — a medida que la tabla crezca, la mayoría de las filas van a estar purgadas, y la
 * consulta de mantenimiento solo mira las vivas.
 */
const INDICES: Array<[string, string]> = [
  [
    `${TABLA}_sin_purgar_idx`,
    `CREATE INDEX ${TABLA}_sin_purgar_idx ON public.${TABLA} USING btree (creado_en) WHERE (purgado_en IS NULL)`,
  ],
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; indices: string[] };
type Estado = { forma: Forma; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  for (const [nombre, patronTipo, aceptaNull, def] of COLUMNAS) {
    const c = e.forma.columnas.find((x) => x.nombre === nombre);
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

  for (const [n, d] of CHECKS) exacto(e.forma.checks, n, d, "el CHECK");
  for (const [n, d] of INDICES) exacto(e.forma.indices, n, d, "el índice");

  /**
   * Los CHECK que YA ESTABAN tienen que seguir. Esta migración no los toca, y verificarlos
   * es lo que haría ruido si un swap mal escrito se llevara uno de paso.
   */
  for (const viejo of [`${TABLA}_estado_check`, `${TABLA}_para_check`, `${TABLA}_tipo_check`]) {
    if (!e.forma.checks.some((x) => x.startsWith(`${viejo}: `))) {
      p.push(`DESAPARECIÓ el CHECK preexistente ${viejo}`);
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

  const estado = async (): Promise<Estado> => {
    const columnas = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${TABLA} ORDER BY ordinal_position`;
    const cons = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = ${TABLA}::regclass ORDER BY conname`;
    const indices = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${TABLA} ORDER BY indexname`;

    const [total] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
    const conteos: Record<string, number> = { filas: total.n as number, purgadas: 0 };
    if (columnas.some((c) => c.column_name === "purgado_en")) {
      const [p] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA} WHERE purgado_en IS NOT NULL`);
      conteos.purgadas = p.n as number;
    }

    return {
      forma: {
        columnas: columnas.map((c) => ({
          nombre: c.column_name as string,
          tipo: c.data_type as string,
          aceptaNull: c.is_nullable === "YES",
          default: (c.column_default as string | null) ?? null,
        })),
        checks: cons.filter((c) => c.contype === "c").map((c) => `${c.conname}: ${c.def}`),
        indices: indices.map((r) => `${r.indexname}: ${r.indexdef}`),
      },
      conteos,
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: la retención ya está con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
      log.push("NO PURGA NADA: purgado_en nace en NULL, o sea 'viva, con su contenido'.");
      log.push("La purga a los 90 días la hace /api/mantenimiento-mail-outbox, aparte y contando.");
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

    /**
     * LOS TRES CAMBIOS DE COLUMNA EN UNA TRANSACCIÓN.
     *
     * Los dos DROP NOT NULL y el ADD COLUMN van juntos porque el CHECK de abajo depende de
     * los tres: si quedaran a medias, el ADD CONSTRAINT fallaría con la tabla en un estado
     * que nadie eligió. Y cada sql del driver HTTP de Neon es su propio request, así que
     * "a medias" es un estado real y no teórico.
     *
     * DROP NOT NULL es idempotente solo: sobre una columna que ya acepta NULL no hace nada
     * y no falla. ADD COLUMN lleva IF NOT EXISTS.
     */
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ALTER COLUMN asunto DROP NOT NULL`),
      sql(`ALTER TABLE ${TABLA} ALTER COLUMN cuerpo DROP NOT NULL`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS purgado_en TIMESTAMPTZ`),
    ]);

    /* El CHECK y el índice por SWAP: DROP IF EXISTS + ADD desnudo, en una transacción.
     * Sin la transacción hay una ventana de un round-trip sin guarda; y si una fila
     * violara el ADD, tira check_violation —que NO es duplicate_object, así que el
     * envoltorio DO $$ EXCEPTION WHEN duplicate_object $$ no lo atraparía— y la
     * transacción deja la guarda anterior en su lugar en vez de dejar la tabla sin
     * ninguna. */
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
        ? "VERIFICADO: asunto y cuerpo aceptan NULL, purgado_en existe, y el CHECK ata las " +
            "tres en los dos sentidos. Los tres CHECK preexistentes siguen en su lugar."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);

    const cambiaron = Object.keys(antes.conteos).filter(
      (k) => despues.conteos[k] !== antes.conteos[k]
    );
    if (cambiaron.length > 0) {
      log.push(
        `ATENCIÓN: cambió ${cambiaron.join(", ")}. Esta migración no purga ni borra una sola ` +
          "fila, así que en main lo más probable es tráfico legítimo entre las dos mediciones."
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
