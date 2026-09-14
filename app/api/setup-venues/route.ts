/**
 * MIGRATION — TANDA 3, §5: venues.
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-venues?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-venues?secret=YOUR_SECRET
 *
 * PURAMENTE ADITIVA. Tres columnas nuevas en `collectives`, dos CHECK y
 * un índice. Ninguna fila se borra, y ninguna se reescribe salvo el
 * backfill de entity_kind, que solo llena NULL con 'collective'.
 *
 * SE PUEDE CORRER CON EL CÓDIGO ACTUAL DESPLEGADO. Nadie lee todavía
 * entity_kind, y los cinco INSERT sobre `collectives` que hay en el repo
 * nombran sus columnas explícitamente, así que el DEFAULT los cubre. No
 * hay ventana de error entre correr esto y desplegar.
 *
 * ============================================================
 * POR QUÉ VENUE COMPARTE TABLA CON COLECTIVO
 * ============================================================
 *
 * §5.2 dice que funcionalmente son casi idénticos —nombre, bio,
 * contacto, ciudad, residentes, eventos, métricas, botón de unirse— y
 * que lo único propio del venue es dirección y capacidad. Y pide
 * evaluar compartir tabla, separando SOLO si eso llena el código de
 * condicionales.
 *
 * Cinco FK reales apuntan hoy a collectives(slug): artist_collectives,
 * collective_genres, collective_genre_tags, collective_cross_tags y
 * merch_items. Una tabla `venues` aparte obligaría a duplicar los cinco,
 * y las membresías —que son el grueso de §5, porque un venue tiene
 * residentes igual que un colectivo— habría que escribirlas dos veces.
 *
 * EL COSTO REAL DE COMPARTIR SON ONCE PUNTOS DE CONTACTO, no "un puñado".
 * La revisión los contó uno por uno: getAllCollectives, getCollectiveBySlug,
 * getCollectivesOwnedBy, getCollectiveMembers, getMyMemberships,
 * getMyCurrentCasa, createCollective, canEditCollective, deleteCollective,
 * y los tres caminos de membership-write que pueden escribir 'casa'.
 * Cinco de ellos son un AND en un WHERE; los otros son guardas nuevas.
 *
 * §5.2 pide separar si compartir llena el código de condicionales, y once
 * es más de lo que esa frase sugiere. Queda como DECISIÓN ABIERTA, anotada
 * en PROGRESO.md: esta migración agrega las columnas, que sirven igual bajo
 * los dos diseños, y no se construye nada encima hasta que se resuelva.
 *
 * La tabla sigue llamándose `collectives` aunque ahora guarde las dos
 * cosas. Renombrarla sería tocar cinco FK, todos los lectores y todos
 * los escritores para ganar claridad de nombre. Queda anotado como
 * deuda, no como olvido.
 *
 * PARA EL USUARIO SIGUEN SIENDO DOS COSAS DISTINTAS, que es lo que §5
 * dice que no se negocia: /venues y /colectivos son secciones separadas
 * con su propia navegación. Compartir tabla es una decisión de adentro y
 * no se filtra a la superficie.
 *
 * ============================================================
 * LA CASA NO VALE EN UN VENUE
 * ============================================================
 *
 * Un DJ es residente de un venue, nunca tiene ahí su casa. Eso NO puede
 * ser un CHECK: el índice único parcial de artist_collectives vive en
 * otra tabla y no ve entity_kind, y un CHECK no puede consultar otra
 * fila. Lo hace cumplir el write path, y esta migración no finge lo
 * contrario. AGENTS.md ya lo dejaba anotado antes de que existiera la
 * columna.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNAS = ["entity_kind", "address", "capacity"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  // No hay ensureConstraint acá, a diferencia de las otras migraciones.
  // El envoltorio DO $$ ... EXCEPTION WHEN duplicate_object $$ existe para
  // que un ADD CONSTRAINT repetido no falle en la segunda corrida. Con el
  // DROP adelante eso no puede pasar: después de borrarlo no queda nada
  // con ese nombre que duplicar, y el handler solo podría tragarse un
  // error real. Los dos CHECK van desnudos dentro de su transacción.

  /**
   * El estado verificable.
   *
   * Reporta is_nullable y column_default, no solo el nombre de la
   * columna, porque ADD COLUMN IF NOT EXISTS compara el nombre: si la
   * columna ya existía sin NOT NULL y sin default, el statement se
   * saltea entero y nadie se entera. Esa columna nullable después
   * acepta NULL desde cualquier INSERT que no la nombre, y el CHECK NO
   * la rechaza, porque NULL IN (...) evalúa a NULL y un CHECK solo
   * falla con false. Quedaría un colectivo publicado que no aparece ni
   * en /colectivos ni en /venues, sin un solo error en ningún log.
   *
   * Los nombres de constraint también, por la misma razón: ADD
   * CONSTRAINT tragado por duplicate_object no distingue "ya está el
   * mismo" de "ya está otro que se llama igual".
   */
  const estado = async () => {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'collectives'
        AND column_name = ANY(${COLUMNAS}::text[])
      ORDER BY column_name
    `;
    const cons = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'collectives'::regclass AND contype = 'c'
      ORDER BY conname
    `;
    // Con la definición, no solo el nombre: CREATE INDEX IF NOT EXISTS
    // también compara por nombre, así que un índice viejo con el mismo
    // nombre sobre otra columna se saltearía en silencio y /venues haría
    // seq scan para siempre.
    const idx = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'collectives'
      ORDER BY indexname
    `;
    const [conteo] = await sql`SELECT COUNT(*)::int AS total FROM collectives`;

    // Si entity_kind todavía no existe, no se puede desglosar por tipo:
    // se informa el total y listo, en vez de inventar un cero.
    const tiene = cols.some((c) => c.column_name === "entity_kind");
    let porTipo: Record<string, number> | null = null;
    let sinTipo: number | null = null;
    if (tiene) {
      const filas = await sql`
        SELECT COALESCE(entity_kind, 'NULL') AS k, COUNT(*)::int AS n
        FROM collectives GROUP BY 1 ORDER BY 1
      `;
      porTipo = Object.fromEntries(filas.map((r) => [r.k as string, r.n as number]));
      const [s] = await sql`SELECT COUNT(*)::int AS n FROM collectives WHERE entity_kind IS NULL`;
      sinTipo = s.n as number;
    }
    return {
      columnasNuevas: cols.map((c) => ({
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      checks: cons.map((c) => `${c.conname}: ${c.def}`),
      indices: idx.map((r) => `${r.indexname}: ${r.indexdef}`),
      filas: { total: conteo.total as number, porTipo, sinTipo },
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const presentes = antes.columnasNuevas.map((c) => c.nombre);
      const faltan = COLUMNAS.filter((c) => !presentes.includes(c));
      log.push(
        faltan.length === 0
          ? "SIMULACIÓN: las tres columnas ya existen. Mirá 'columnasNuevas' y 'checks': que existan no prueba que tengan la forma correcta."
          : `SIMULACIÓN: se agregarían ${faltan.length} columnas (${faltan.join(", ")})`
      );
      log.push(
        `SIMULACIÓN: ${antes.filas.total} filas en collectives quedarían como 'collective'. Ninguna se borra ni se convierte en venue.`
      );
      const nullable = antes.columnasNuevas.find((c) => c.nombre === "entity_kind" && c.aceptaNull);
      if (nullable) {
        log.push(
          "OJO: entity_kind ya existe y acepta NULL. La corrida real lo va a corregir con SET NOT NULL."
        );
      }
      // La corrida real destruye y recrea dos CHECK. Decirlo acá, que es
      // lo único que se puede mirar antes de tocar main, en vez de
      // obligar a cruzar 'checks' a mano.
      const aRecrear = antes.checks.filter(
        (c) => c.startsWith("collectives_entity_kind_check") || c.startsWith("collectives_capacity_check")
      );
      log.push(
        aRecrear.length === 0
          ? "SIMULACIÓN: se crearían los CHECK collectives_entity_kind_check y collectives_capacity_check"
          : `SIMULACIÓN: se DESTRUIRÍAN Y RECREARÍAN estos CHECK ya existentes: ${aRecrear.join(" | ")}`
      );
      return NextResponse.json({ ok: true, dryRun, log, estado: antes, seAgregarian: faltan });
    }

    // --- columnas ---------------------------------------------------
    // DEFAULT 'collective' hace que toda fila existente y toda fila
    // nueva que no diga nada sea un colectivo. Un venue tiene que
    // declararse: el default nunca convierte nada por accidente.
    await sql`
      ALTER TABLE collectives
        ADD COLUMN IF NOT EXISTS entity_kind TEXT NOT NULL DEFAULT 'collective'
    `;
    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS address TEXT`;
    await sql`ALTER TABLE collectives ADD COLUMN IF NOT EXISTS capacity INTEGER`;
    log.push("columnas entity_kind, address y capacity listas");

    // Backfill defensivo. ADD COLUMN con DEFAULT ya llena las filas
    // existentes, pero si una corrida anterior agregó la columna sin
    // default, quedarían NULL. Solo toca NULL: nunca reescribe un valor.
    const rellenadas = await sql`
      UPDATE collectives SET entity_kind = 'collective'
      WHERE entity_kind IS NULL
      RETURNING slug
    `;
    log.push(
      rellenadas.length === 0
        ? "backfill: ninguna fila tenía entity_kind NULL"
        : `backfill: ${rellenadas.length} filas pasaron de NULL a 'collective'`
    );

    // La forma se fija explícitamente en vez de confiar en el ADD COLUMN.
    //
    // ADD COLUMN IF NOT EXISTS compara el NOMBRE: si la columna ya existe
    // con otra definición, el statement entero se saltea y el NOT NULL y
    // el DEFAULT nunca se aplican. Una entity_kind nullable después acepta
    // NULL desde los tres INSERT del repo que no la nombran, y el CHECK no
    // los rechaza, porque NULL IN (...) evalúa a NULL y un CHECK solo falla
    // con false. El resultado sería un colectivo publicado invisible en
    // /colectivos y en /venues a la vez, sin un error en ningún log.
    //
    // Las dos sentencias son idempotentes solas: fijar NOT NULL sobre una
    // columna que ya lo es, o el mismo default, no hace nada. Van DESPUÉS
    // del backfill, que es lo que garantiza que no quede ningún NULL para
    // que el SET NOT NULL pueda pasar.
    await sql`ALTER TABLE collectives ALTER COLUMN entity_kind SET DEFAULT 'collective'`;
    await sql`ALTER TABLE collectives ALTER COLUMN entity_kind SET NOT NULL`;
    log.push("entity_kind fijada como NOT NULL DEFAULT 'collective'");

    // DROP y ADD EN UNA SOLA TRANSACCIÓN, que es el patrón que ya usa
    // setup-membership-kinds para su swap.
    //
    // El DROP hace falta porque el handler de duplicate_object no
    // distingue "ya está el mismo CHECK" de "ya está OTRO que se llama
    // igual": un borrador viejo que prohibiera 'venue' se tragaría en
    // silencio, el log diría "listo", y el primer INSERT de un venue
    // fallaría contradiciendo a la migración.
    //
    // Pero cada sql`` del driver HTTP de Neon es su propio request y su
    // propia transacción. Un DROP y un ADD sueltos dejan una ventana de
    // un round-trip entero sin CHECK, y si el ADD falla —una fila vieja
    // con un valor que el CHECK nuevo no acepta da check_violation, que
    // NO es duplicate_object y no se atrapa— la ventana no se cierra
    // nunca: la tabla queda sin guarda, peor que antes de empezar. En
    // una transacción, el fallo del ADD revierte el DROP y la tabla
    // queda como estaba.
    //
    // Adentro de la transacción el ADD va desnudo, sin el envoltorio de
    // duplicate_object: después del DROP no puede quedar nada con ese
    // nombre que duplicar, así que el handler sería red muerta que solo
    // podría esconder un error real.
    await sql.transaction([
      sql`ALTER TABLE collectives DROP CONSTRAINT IF EXISTS collectives_entity_kind_check`,
      sql`ALTER TABLE collectives ADD CONSTRAINT collectives_entity_kind_check
            CHECK (entity_kind IN ('collective','venue'))`,
    ]);
    log.push("check de entity_kind listo (drop + add atómico)");

    // capacity es de venues, pero se valida para los dos: un número de
    // aforo negativo no es válido en ninguna fila.
    await sql.transaction([
      sql`ALTER TABLE collectives DROP CONSTRAINT IF EXISTS collectives_capacity_check`,
      sql`ALTER TABLE collectives ADD CONSTRAINT collectives_capacity_check
            CHECK (capacity IS NULL OR capacity > 0)`,
    ]);
    log.push("check de capacity listo (drop + add atómico)");

    // /venues y /colectivos filtran por esta columna en cada carga.
    await sql`
      CREATE INDEX IF NOT EXISTS collectives_entity_kind_idx ON collectives (entity_kind)
    `;
    log.push("índice de entity_kind listo");

    try {
      const despues = await estado();
      log.push(
        `${despues.filas.total} filas en collectives: ${JSON.stringify(despues.filas.porTipo)}`
      );
      if (antes.filas.total !== despues.filas.total) {
        log.push(
          `ALERTA: el total de filas cambió, de ${antes.filas.total} a ${despues.filas.total}. Esta migración no crea ni borra filas: revisalo antes de seguir.`
        );
      }
      // Los dos estados, no solo el final: el conteo de antes no sirve de
      // nada si no se puede comparar contra el de después en la misma
      // respuesta, que es la única que se lee cuando se corre en main.
      return NextResponse.json({ ok: true, dryRun, log, antes, despues });
    } catch (err) {
      log.push("la migración terminó, pero la verificación posterior falló");
      // `antes` va igual. Es justo la corrida que no se puede volver a
      // mirar, y el conteo previo ya estaba en memoria: devolver menos
      // información en el peor caso sería exactamente al revés.
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
