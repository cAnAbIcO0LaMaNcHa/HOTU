/**
 * MIGRATION — residency_offers: el dueño ofrece, el DJ acepta (§8 fase 2).
 *
 *   /api/setup-residency-offers?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-residency-offers?secret=YOUR_SECRET
 *
 * UNA TABLA NUEVA Y NADA MÁS. Sin backfill, y sin tocar artist_collectives.
 *
 * ============================================================
 * QUÉ PROBLEMA RESUELVE
 * ============================================================
 *
 * En la fase 2, 'residente' deja de ser una etiqueta y pasa a ser PERMISO
 * PARA EDITAR el colectivo. Con eso, quién lo concede cambia de manos: ya no
 * lo elige el DJ solo, lo OFRECE el dueño y el DJ ACEPTA. Las dos partes.
 *
 * Una oferta aceptada o rechazada es un evento entre dos personas, y hasta
 * que el DJ responda hay un estado intermedio que existe y hay que guardar
 * en algún lado.
 *
 * ============================================================
 * POR QUÉ UNA TABLA Y NO COLUMNAS EN artist_collectives
 * ============================================================
 *
 * La primera idea —guardar la oferta como una fila pendiente de
 * artist_collectives con kind='residente'— está MEDIDA y no funciona. El
 * índice único es:
 *
 *   artist_collectives_one_active_residente_idx
 *     ON artist_collectives (artist_slug)
 *     WHERE kind = 'residente' AND to_date IS NULL
 *
 * No mira accepted_at. Así que una fila pendiente con kind='residente'
 * OCUPA el cupo de residencia del DJ antes de que él acepte, y le bloquea
 * mover la residencia que ya tiene — que es exactamente el caso que la
 * decisión del DJ tiene que poder resolver. Es el mismo motivo por el que
 * PENDING_KIND es 'miembro' en membership-write: el valor no exclusivo es el
 * único seguro para una fila que todavía no es nada.
 *
 * La segunda idea —columnas offered_* sobre artist_collectives— tampoco:
 * habría que agregar cuatro nullables con estados mutuamente excluyentes, y
 * después distinguir "oferta abierta" de "oferta ya resuelta y el DJ
 * renunció" sobre los mismos campos. Eso es una tabla, escrita de mala gana.
 *
 * Y hay una razón de transición que decide sola: no tocando
 * artist_collectives, TODOS los lectores de hoy siguen siendo correctos. Una
 * oferta pendiente no puede disfrazarse de residencia ante nadie, porque no
 * vive en la tabla que los lectores miran.
 *
 * ============================================================
 * LA OFERTA SE RESUELVE, NO SE BORRA
 * ============================================================
 *
 * resolved_at + outcome, y la fila queda. Lo que se está registrando es
 * QUIÉN concedió un permiso de edición sobre un colectivo, y eso es
 * precisamente lo que setup-cierre-residentes necesitó para negarse a
 * convertir filas: la diferencia entre "el dueño lo invitó" y "el DJ se lo
 * eligió" tiene que seguir siendo comprobable después, no solo en el momento.
 *
 * offered_by va con ON DELETE SET NULL, igual que censored_by, reviewed_by y
 * banned_by: si la cuenta del dueño se elimina, la oferta SIGUIÓ pasando y
 * el residente sigue teniendo su permiso. Se pierde el nombre, no el hecho.
 *
 * ============================================================
 * DOS GUARDAS QUE ESTA TABLA NO PUEDE DAR, Y VAN EN EL WRITE PATH
 * ============================================================
 *
 * ESTÁ MEDIDO, no supuesto: una oferta a un VENUE la acepta este schema sin
 * chistar. El FK contra collectives(slug) garantiza que el slug existe, no que
 * su entity_kind sea 'collective', y un CHECK no puede consultar otra tabla.
 * Es la misma razón por la que setup-venues dice que el índice no ve
 * entity_kind y por la que AGENTS.md ya obliga a validar la casa en el write
 * path y no solo con el índice.
 *
 * Tampoco puede impedir que se ACEPTE una oferta cuando el DJ ya tiene una
 * residencia activa en otro colectivo: el índice único de acá es por par
 * (artista, colectivo), y el de una-sola-residencia vive en la otra tabla y
 * recién se entera cuando la fila de artist_collectives se escribe.
 *
 * Entonces el lib que ofrezca y acepte TIENE que:
 *   1. rechazar la oferta si collectives.entity_kind <> 'collective';
 *   2. al aceptar con otra residencia activa, devolver las opciones y no
 *      mover nada — renunciar a la anterior o rechazar esta, nunca reemplazo
 *      automático.
 *
 * Queda escrito acá porque es donde alguien va a venir a leer qué significa
 * una oferta, y una guarda que solo vive en el código es una guarda que la
 * próxima persona no sabe que existe.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLA = "residency_offers";

/** nombre, tipo esperado, aceptaNull, default esperado (null = ninguno). */
const COLUMNAS: Array<[string, RegExp, boolean, string | null]> = [
  ["id", /integer/i, false, `nextval('${TABLA}_id_seq'::regclass)`],
  ["artist_slug", /text/i, false, null],
  ["collective_slug", /text/i, false, null],
  ["offered_by", /text/i, true, null],
  ["offered_at", /timestamp with time zone/i, false, "now()"],
  ["resolved_at", /timestamp with time zone/i, true, null],
  ["outcome", /text/i, true, null],
];

const CHECKS: Array<[string, string]> = [
  [
    `${TABLA}_outcome_check`,
    "CHECK ((outcome = ANY (ARRAY['accepted'::text, 'declined'::text, 'revoked'::text])))",
  ],
  /**
   * Los dos campos del cierre van juntos o no van. Sin esto se puede escribir
   * un resolved_at sin decir CÓMO terminó, y una oferta cerrada sin resultado
   * es indistinguible de una abierta para cualquier consulta que filtre por
   * outcome — se pierde callado, que es el peor modo.
   */
  [
    `${TABLA}_resuelta_check`,
    "CHECK ((((resolved_at IS NULL) AND (outcome IS NULL)) OR ((resolved_at IS NOT NULL) AND (outcome IS NOT NULL))))",
  ],
];

const FKS: Array<[string, string]> = [
  [
    `${TABLA}_artist_slug_fkey`,
    "FOREIGN KEY (artist_slug) REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE",
  ],
  [
    `${TABLA}_collective_slug_fkey`,
    "FOREIGN KEY (collective_slug) REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE",
  ],
  /**
   * SET NULL y no CASCADE: si el dueño borra su cuenta, la oferta siguió
   * existiendo y el residente sigue teniendo el permiso que le dieron.
   */
  [
    `${TABLA}_offered_by_fkey`,
    "FOREIGN KEY (offered_by) REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL",
  ],
];

const INDICES: Array<[string, string]> = [
  /**
   * UNA sola oferta abierta por par. Sin esto el dueño puede apilar ofertas
   * al mismo DJ, y la bandeja del DJ muestra tres veces lo mismo sin que
   * ninguna sea la buena.
   */
  [
    `${TABLA}_una_abierta_idx`,
    `CREATE UNIQUE INDEX ${TABLA}_una_abierta_idx ON public.${TABLA} ` +
      `USING btree (artist_slug, collective_slug) WHERE (resolved_at IS NULL)`,
  ],
  /** La bandeja del DJ: qué tengo para responder. */
  [
    `${TABLA}_artista_abiertas_idx`,
    `CREATE INDEX ${TABLA}_artista_abiertas_idx ON public.${TABLA} ` +
      `USING btree (artist_slug) WHERE (resolved_at IS NULL)`,
  ],
  /** La vista del colectivo: qué ofrecí y cómo salió, lo más nuevo primero. */
  [
    `${TABLA}_colectivo_idx`,
    `CREATE INDEX ${TABLA}_colectivo_idx ON public.${TABLA} ` +
      `USING btree (collective_slug, offered_at DESC)`,
  ],
];

type Columna = { nombre: string; tipo: string; aceptaNull: boolean; default: string | null };
type Forma = { columnas: Columna[]; checks: string[]; fks: string[]; indices: string[] };
type Estado = { existeTabla: boolean; forma: Forma; conteos: Record<string, number> };

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];
  if (!e.existeTabla) return { ok: false, problemas: [`falta la tabla ${TABLA}`] };

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

  /**
   * Se compara la DEFINICIÓN completa y no el nombre. Un CREATE INDEX IF NOT
   * EXISTS con el nombre tomado no hace nada y no falla, así que verificar la
   * existencia es verificar que alguien eligió ese nombre alguna vez.
   */
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
  for (const [n, d] of FKS) exacto(e.forma.fks, n, d, "el FK");
  for (const [n, d] of INDICES) exacto(e.forma.indices, n, d, "el índice");

  /**
   * Y que no haya FK DE MÁS. Los tres de arriba están elegidos uno por uno;
   * un cuarto significaría que alguien ató esta tabla a algo sin decidir qué
   * pasa cuando eso se borre.
   */
  if (e.forma.fks.length !== FKS.length) {
    p.push(
      `${TABLA} tiene ${e.forma.fks.length} FK y se esperaban ${FKS.length}: ${e.forma.fks.join("; ")}`
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
    const [res] = await sql`
      SELECT COUNT(*)::int AS n FROM artist_collectives WHERE kind = 'residente' AND to_date IS NULL`;
    const conteos: Record<string, number> = {
      filas_artist_collectives: ac.n as number,
      residencias_activas: res.n as number,
      filas_ofertas: 0,
    };
    if (existe) {
      const [o] = await sql(`SELECT COUNT(*)::int AS n FROM ${TABLA}`);
      conteos.filas_ofertas = o.n as number;
    }
    return { existeTabla: Boolean(existe), forma, conteos };
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
      log.push("SIN BACKFILL: no hay ofertas viejas que inventar. Las residencias que ya existen");
      log.push("  se quedan como están: esta tabla registra las que se concedan DE ACÁ EN ADELANTE.");
      log.push("NO TOCA artist_collectives: ningún lector de hoy cambia de respuesta.");
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
     * Los FK y CHECK van INLINE en el CREATE TABLE IF NOT EXISTS, que ya es
     * idempotente solo: si la tabla existe, el statement entero no hace nada.
     * Postgres no tiene ADD CONSTRAINT IF NOT EXISTS, así que los de abajo —el
     * camino de recuperación— van con DROP + ADD en una transacción, que es la
     * única forma de reemplazar una guarda sin dejar una ventana sin ella.
     */
    await sql(`
      CREATE TABLE IF NOT EXISTS ${TABLA} (
        id SERIAL PRIMARY KEY,
        artist_slug TEXT NOT NULL REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        collective_slug TEXT NOT NULL REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        offered_by TEXT REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE SET NULL,
        offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ,
        outcome TEXT,
        CONSTRAINT ${TABLA}_outcome_check
          CHECK (outcome IN ('accepted','declined','revoked')),
        CONSTRAINT ${TABLA}_resuelta_check
          CHECK ((resolved_at IS NULL AND outcome IS NULL)
              OR (resolved_at IS NOT NULL AND outcome IS NOT NULL))
      )
    `);

    /**
     * Recuperación por si la tabla quedó a medias. Sin NOT NULL a propósito: un
     * ADD COLUMN NOT NULL sin default sobre una tabla con filas falla. El NOT
     * NULL definitivo lo afirma el CREATE TABLE, y si no quedó, verificarForma
     * lo dice y `verificado` se va a false — que es la diferencia entre "no tiró
     * excepción" y "quedó como dice que quedó".
     */
    await sql.transaction([
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS artist_slug TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS collective_slug TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS offered_by TEXT`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ NOT NULL DEFAULT now()`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`),
      sql(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS outcome TEXT`),
    ]);

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
        ? `VERIFICADO: ${TABLA} con sus ${COLUMNAS.length} columnas, ${CHECKS.length} CHECK, ` +
          `${FKS.length} FK y ${INDICES.length} índices, con la forma esperada.`
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
