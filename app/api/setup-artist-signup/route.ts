/**
 * MIGRATION — ALTA-DJ paso 1: lo que el alta de artista necesita en la base.
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-artist-signup?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-artist-signup?secret=YOUR_SECRET
 *
 * PURAMENTE ADITIVA. Dos defaults, cinco columnas, dos CHECK y un
 * índice. Ninguna fila se borra, y lo único que se reescribe es el
 * backfill de review_status, que llena filas que hasta ahora no tenían
 * la columna.
 *
 * ============================================================
 * 1. district DEJA DE SER OBLIGATORIA EN EL FORMULARIO
 * ============================================================
 *
 * artists.district es NOT NULL sin default, así que hoy todo INSERT
 * tiene que nombrarla. El formulario de alta no puede: el sistema de
 * distritos se elimina en la tanda 4 §3 y pedirle a alguien que se
 * registra que elija un distrito que estamos por borrar sería trabajo
 * hecho dos veces y un dato inventado.
 *
 * Con DEFAULT 'D00' el formulario no la menciona. La columna sigue NOT
 * NULL y sigue existiendo: esto no la borra ni la vacía, que es otra
 * migración de otro día.
 *
 * ============================================================
 * 2. review_status ES UNA COLUMNA PROPIA, NO UN VALOR DE status
 * ============================================================
 *
 * `status` es la visibilidad editorial y la comparten las SEIS tablas de
 * contenido. Meterle un valor 'rechazado' se filtraría a eventos,
 * noticias, sets y tracks, que no tienen revisión ninguna.
 *
 * Son dos preguntas distintas y quedan en dos columnas:
 *   status         ¿es pública?
 *   review_status  ¿dónde está en la cola de aprobación?
 *
 * Es la misma separación que el proyecto ya hizo entre status y
 * status_membership, y por la misma razón.
 *
 * Cuatro valores, NO tres, y NOT NULL:
 *   borrador     recién creado, el DJ lo está llenando
 *   en_revision  lo mandó a aprobar
 *   rechazado    con motivo, puede corregir y reenviar
 *   aprobado     publicado, fuera de la cola
 *
 * 'aprobado' existe para que NULL no signifique dos cosas a la vez
 * ("nunca se revisó" y "ya se aprobó"). Una columna donde el vacío es
 * ambiguo es la que después se lee mal.
 *
 * ============================================================
 * 3. UN RECHAZO SIN MOTIVO NO SE PUEDE GUARDAR
 * ============================================================
 *
 * El requisito es "rechazo con motivo, visible para el DJ". El write
 * path lo va a exigir, pero acá sí se puede hacer cumplir de verdad,
 * porque compara dos columnas de la MISMA fila y eso un CHECK lo puede
 * hacer. Un rechazo sin texto es un DJ que no sabe qué corregir, y la
 * base lo rechaza.
 *
 * (El caso opuesto —"una casa nunca en un venue"— NO pudo ser un CHECK
 * justamente porque miraba otra tabla. La diferencia es esa.)
 *
 * ============================================================
 * 4. status PASA A DEFAULT 'draft', Y ESTO ES LA COMPUERTA
 * ============================================================
 *
 * artists.status venía con DEFAULT 'published'. Junto con el default
 * 'borrador' de review_status, los dos producen el par imposible:
 * PÚBLICO + BORRADOR. Un INSERT que no nombre ninguna de las dos crea un
 * artista que se ve en /artistas, que la cola de /admin/artistas nunca
 * muestra porque solo lee 'en_revision', y sobre el que su dueño ve una
 * franja diciendo que todavía no es público.
 *
 * Peor: si createArtist() se olvidara de nombrar status, CADA DJ que se
 * registre quedaría publicado al instante y la aprobación entera sería
 * decorativa. Sin error y sin fila perdida: solo la regla incumplida.
 *
 * Un default tiene que fallar del lado cerrado. Ahora un INSERT que no
 * dice nada crea un borrador invisible, que es lo recuperable; publicar
 * exige decirlo.
 *
 * El único INSERT del repo que no nombraba status es el de
 * app/api/migrate/route.ts, que siembra los artistas del prototipo. Va
 * con 'published' explícito en el mismo commit que esta migración. Es un
 * no-op en las dos branches (tiene ON CONFLICT DO NOTHING y las filas ya
 * están), así que el cambio no altera ningún dato existente.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNAS = ["review_status", "review_note", "submitted_at", "reviewed_at", "reviewed_by"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  /**
   * El estado verificable: forma, no existencia.
   *
   * Reporta tipo, nullabilidad y default de cada columna, más los CHECK
   * y los índices con su definición. ADD COLUMN IF NOT EXISTS y CREATE
   * INDEX IF NOT EXISTS comparan el NOMBRE: una columna preexistente con
   * otra definición hace que el statement se saltee entero y nadie se
   * entera. Sin esto, el log afirmaría cosas que no comprobó.
   */
  const estado = async () => {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artists'
        AND column_name = ANY(${[...COLUMNAS, "district", "status"]}::text[])
      ORDER BY column_name
    `;
    // CHECK y FK, no solo CHECK. El FK de reviewed_by va por el camino
    // que se traga duplicate_object, así que es justamente el objeto que
    // más necesita quedar reportado: si ya existiera con otra definición,
    // el handler lo silenciaría y nada lo desmentiría.
    const cons = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'artists'::regclass AND contype IN ('c','f')
      ORDER BY conname
    `;
    const idx = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'artists'
      ORDER BY indexname
    `;
    const [tot] = await sql`SELECT COUNT(*)::int AS total FROM artists`;

    const tieneReview = cols.some((c) => c.column_name === "review_status");
    let porRevision: Record<string, number> | null = null;
    let sinRevision: number | null = null;
    if (tieneReview) {
      const filas = await sql`
        SELECT COALESCE(review_status, 'NULL') AS k, COUNT(*)::int AS n
        FROM artists GROUP BY 1 ORDER BY 1
      `;
      porRevision = Object.fromEntries(filas.map((r) => [r.k as string, r.n as number]));
      const [s] = await sql`SELECT COUNT(*)::int AS n FROM artists WHERE review_status IS NULL`;
      sinRevision = s.n as number;
    }

    const porStatus = Object.fromEntries(
      (await sql`SELECT status, COUNT(*)::int AS n FROM artists GROUP BY 1 ORDER BY 1`).map(
        (r) => [r.status as string, r.n as number]
      )
    );

    return {
      columnas: cols.map((c) => ({
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      checks: cons.map((c) => `${c.conname}: ${c.def}`),
      indices: idx.map((r) => `${r.indexname}: ${r.indexdef}`),
      filas: { total: tot.total as number, porStatus, porRevision, sinRevision },
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const presentes = antes.columnas.map((c) => c.nombre);
      const faltan = COLUMNAS.filter((c) => !presentes.includes(c));
      const district = antes.columnas.find((c) => c.nombre === "district");

      log.push(
        faltan.length === 0
          ? "SIMULACIÓN: las cuatro columnas de revisión ya existen. Mirá 'columnas' y 'checks': que existan no prueba que tengan la forma correcta."
          : `SIMULACIÓN: se agregarían ${faltan.length} columnas (${faltan.join(", ")})`
      );
      const status = antes.columnas.find((c) => c.nombre === "status");
      log.push(
        `SIMULACIÓN: district pasa a DEFAULT 'D00' (hoy ${district?.default ?? "sin default"}) y status a DEFAULT 'draft' (hoy ${status?.default ?? "sin default"}). Ninguna fila existente cambia: los defaults solo afectan INSERT que no nombren la columna.`
      );
      const noPublicados = Object.entries(antes.filas.porStatus)
        .filter(([k]) => k !== "published")
        .map(([k, n]) => `${n} ${k}`);
      if (noPublicados.length > 0) {
        log.push(
          `OJO: hay artistas que no están publicados (${noPublicados.join(", ")}). El backfill los deja en 'borrador', así que su dueño va a poder mandarlos a revisión. Si estaban retirados a propósito, miralo antes de correrla.`
        );
      }
      log.push(
        `SIMULACIÓN: ${antes.filas.total} artistas. Los publicados quedarían 'aprobado' y el resto 'borrador'. Ninguno entra en la cola de revisión.`
      );
      log.push(
        "SIMULACIÓN: se crearían los CHECK artists_review_status_check y artists_rechazo_con_motivo_check"
      );
      return NextResponse.json({ ok: true, dryRun, log, estado: antes, seAgregarian: faltan });
    }

    // --- defaults de district y status ---------------------------------
    // Ninguno toca una fila: solo cambian lo que pasa cuando un INSERT no
    // nombra la columna. Los 17 distritos y los 17 status actuales quedan
    // exactamente como están.
    await sql`ALTER TABLE artists ALTER COLUMN district SET DEFAULT 'D00'`;
    await sql`ALTER TABLE artists ALTER COLUMN status SET DEFAULT 'draft'`;
    log.push("defaults: district 'D00' y status 'draft' (ninguna fila existente cambia)");

    // --- columnas de revisión, en UNA transacción ----------------------
    // El bloque entero va junto porque entre el ADD COLUMN (sin default) y
    // el SET DEFAULT hay una ventana en la que un INSERT concurrente que
    // no nombre la columna escribiría NULL, y el SET NOT NULL de dos
    // líneas más abajo fallaría con la migración a medio aplicar. Son
    // requests separados en el driver HTTP de Neon, así que sin la
    // transacción la ventana es real.
    //
    // review_status entra SIN default a propósito: el NULL es lo que le
    // permite al backfill distinguir "esta fila es nueva para la columna"
    // de cualquier valor que la migración misma haya escrito. Es una
    // guarda de una sola vía, que la migración destruye y nunca recrea,
    // y por eso la segunda corrida no puede volver a tocar nada. Con
    // DEFAULT desde el ADD COLUMN, la guarda del backfill tendría que ser
    // un valor que el propio paso anterior escribió, que es exactamente
    // la forma del bug del renombre de kind de la tanda 3.
    //
    // El SET DEFAULT va ANTES del SET NOT NULL: al revés, un INSERT en el
    // medio escribiría NULL sobre una columna todavía sin default.
    const pasos = await sql.transaction([
      sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS review_status TEXT`,
      sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS review_note TEXT`,
      // submitted_at: cuándo entró a la cola. Sin esto no se puede saber
      // cuánto lleva esperando, y una cola sin antigüedad visible es una
      // cola donde lo viejo se hunde y nadie se entera.
      sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`,
      sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
      sql`ALTER TABLE artists ADD COLUMN IF NOT EXISTS reviewed_by TEXT`,
      // Backfill por status, no a ciegas: un artista publicado ya pasó el
      // filtro que la revisión hubiera aplicado, así que es 'aprobado'.
      // Uno que no lo está nunca se mandó a revisar, así que es
      // 'borrador'. Ninguno entra en la cola: esta migración no le
      // inventa trabajo a nadie.
      sql`UPDATE artists SET review_status = 'aprobado'
          WHERE review_status IS NULL AND status = 'published' RETURNING slug`,
      sql`UPDATE artists SET review_status = 'borrador'
          WHERE review_status IS NULL RETURNING slug`,
      sql`ALTER TABLE artists ALTER COLUMN review_status SET DEFAULT 'borrador'`,
      sql`ALTER TABLE artists ALTER COLUMN review_status SET NOT NULL`,
    ]);
    const aprobados = pasos[4] as unknown[];
    const borradores = pasos[5] as unknown[];
    log.push("columnas review_status, review_note, submitted_at, reviewed_at y reviewed_by listas");
    log.push(
      `backfill: ${aprobados.length} publicados a 'aprobado', ${borradores.length} no publicados a 'borrador'`
    );
    log.push("review_status fijada como NOT NULL DEFAULT 'borrador'");

    // El FK va aparte y envuelto: ADD CONSTRAINT no tiene IF NOT EXISTS.
    // ON DELETE SET NULL — borrar la cuenta de un admin no puede bloquear
    // nada ni borrar el artista; se pierde quién revisó y se conservan el
    // motivo y la fecha, que es lo que le sirve al DJ.
    await sql(
      `DO $$ BEGIN
         ALTER TABLE artists ADD CONSTRAINT artists_reviewed_by_fkey
           FOREIGN KEY (reviewed_by) REFERENCES user_profiles(email)
           ON UPDATE CASCADE ON DELETE SET NULL;
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    );
    log.push("FK de reviewed_by hacia user_profiles listo");

    // --- CHECKs --------------------------------------------------------
    // DROP y ADD en UNA transacción, que es la regla de AGENTS.md: son dos
    // requests en el driver HTTP de Neon, y sueltos dejan una ventana sin
    // guarda que no se cierra si el ADD falla. Adentro el ADD va desnudo:
    // después del DROP no queda nada con ese nombre que duplicar.
    await sql.transaction([
      sql`ALTER TABLE artists DROP CONSTRAINT IF EXISTS artists_review_status_check`,
      sql`ALTER TABLE artists ADD CONSTRAINT artists_review_status_check
            CHECK (review_status IN ('borrador','en_revision','rechazado','aprobado'))`,
    ]);
    log.push("check de review_status listo (drop + add atómico)");

    // Un rechazo sin motivo no se puede guardar. Compara dos columnas de
    // la misma fila, que es lo único que un CHECK puede hacer, y acá
    // alcanza.
    //
    // btrim CON su segundo argumento. Sin él recorta solo el espacio
    // ASCII, así que un textarea que quedó con un salto de línea, o un
    // espacio duro pegado desde un documento, pasarían el CHECK y el DJ
    // vería una pantalla de rechazo con el motivo en blanco. El conjunto
    // cubre espacio, tab, retorno, salto de línea y U+00A0.
    await sql.transaction([
      sql`ALTER TABLE artists DROP CONSTRAINT IF EXISTS artists_rechazo_con_motivo_check`,
      sql`ALTER TABLE artists ADD CONSTRAINT artists_rechazo_con_motivo_check
            CHECK (review_status <> 'rechazado'
                   OR (review_note IS NOT NULL
                       AND btrim(review_note, E' \\t\\r\\n\\u00A0') <> ''))`,
    ]);
    log.push("check de rechazo-con-motivo listo (drop + add atómico)");

    // --- índice --------------------------------------------------------
    // Parcial: la cola de /admin/artistas lee solo los 'en_revision', que
    // van a ser un puñado contra una tabla que crece. Un índice sobre toda
    // la columna guardaría 'aprobado' miles de veces sin que nadie lo
    // consulte.
    await sql`
      CREATE INDEX IF NOT EXISTS artists_en_revision_idx
      ON artists (review_status) WHERE review_status = 'en_revision'
    `;
    log.push("índice parcial de la cola de revisión listo");

    try {
      const despues = await estado();
      log.push(
        `${despues.filas.total} artistas: ${JSON.stringify(despues.filas.porRevision)}`
      );
      if (antes.filas.total !== despues.filas.total) {
        log.push(
          `ALERTA: el total de artistas cambió, de ${antes.filas.total} a ${despues.filas.total}. Esta migración no crea ni borra filas: revisalo antes de seguir.`
        );
      }
      // Se compara contra ANTES, no contra cero. A partir del paso 5 va a
      // haber artistas legítimamente en revisión, y una alerta que grite
      // cada vez que se re-corra la migración se vuelve ruido que nadie
      // lee. Lo que importa es que ESTA migración no haya metido a nadie
      // en la cola, y eso es la diferencia, no el total.
      const enRevisionAntes = antes.filas.porRevision?.en_revision ?? 0;
      const enRevisionDespues = despues.filas.porRevision?.en_revision ?? 0;
      if (enRevisionDespues > enRevisionAntes) {
        log.push(
          `ALERTA: la cola de revisión creció de ${enRevisionAntes} a ${enRevisionDespues}. El backfill no debería meter a nadie ahí.`
        );
      }
      return NextResponse.json({ ok: true, dryRun, log, antes, despues });
    } catch (err) {
      log.push("la migración terminó, pero la verificación posterior falló");
      return NextResponse.json({
        ok: true,
        verificado: false,
        dryRun,
        log,
        antes,
        verificacionFallo: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, dryRun, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
