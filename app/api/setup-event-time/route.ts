/**
 * MIGRATION COMBINADA — hora de inicio, y dos CHECK que venían atrasados.
 *
 *   /api/setup-event-time?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-event-time?secret=YOUR_SECRET
 *
 * Cuatro cosas, y van juntas porque las cuatro son sobre las mismas dos tablas y
 * correr cuatro migraciones para cuatro ALTER es cuatro veces la ceremonia:
 *
 *   1. events.starts_at TIMESTAMPTZ, nullable, sin default. La hora de inicio.
 *   2. events_fin_despues_de_inicio_check: end_at > starts_at cuando los dos están.
 *   3. events_door_price_check SIN TOPE. Main lo tiene con tope de 10.000.000,
 *      de la primera versión de setup-door-price. Acá se salda.
 *   4. edit_log_actor_rol_check gana 'moderador'.
 *
 * ============================================================
 * 1. POR QUÉ UNA COLUMNA NUEVA Y NO TRANSFORMAR event_date
 * ============================================================
 *
 * event_date es DATE y tiene 36 referencias en el código. Convertirla a
 * TIMESTAMPTZ las toca todas y, lo que la descarta, LES INVENTA UNA HORA a los
 * eventos que ya existen: medianoche. Una fiesta anunciada "el 15" pasaría a
 * anunciarse "el 15 a las 00:00", que es mentira, y eventHasEnded empezaría a
 * darlas por terminadas mucho antes para las que no tienen end_at.
 *
 * starts_at es TIMESTAMPTZ igual que end_at, así que la DURACIÓN es una resta y
 * no hay que inventar aritmética de zonas. NULL = no dijo hora, y la página no
 * muestra nada: el mismo criterio que door_price_cop y que end_at.
 *
 * event_date SIGUE SIENDO EL DÍA AUTORITATIVO. starts_at solo agrega el reloj.
 *
 * ============================================================
 * NO HAY CHECK QUE ATE starts_at A event_date, Y ES A PROPÓSITO
 * ============================================================
 *
 * Sería el CHECK obvio —que starts_at caiga en event_date— y sería una guarda
 * que MIENTE. Pasa por starts_at::date, que depende de la zona de la sesión: la
 * misma fila da true o false según con qué TimeZone se consulte, y Vercel corre
 * en UTC mientras la escena está en Bogotá.
 *
 * Y además sería FALSO como regla, por la madrugada: en la escena una fiesta del
 * "sábado 15" arranca a la 1:00, y esa 1:00 es del domingo 16. O sea que
 * starts_at legítimamente NO cae en event_date más o menos la mitad de las veces.
 *
 * La regla vive en el write path: una hora entre 00:00 y 06:00 pertenece a la
 * noche de event_date y se guarda en el día SIGUIENTE, con zona America/Bogota
 * explícita. Acá no hay nada que comprobar porque no hay nada que sea siempre
 * cierto.
 *
 * ============================================================
 * 2. EL CHECK DE FIN > INICIO SÍ SE PUEDE, PORQUE SON DEL MISMO TIPO
 * ============================================================
 *
 * end_at > starts_at compara dos TIMESTAMPTZ, así que NO depende de la zona: los
 * dos son instantes. Es la diferencia exacta con el CHECK que no se pone.
 *
 * Y antes de agregarlo se CUENTA cuántas filas lo violarían. Si hay alguna, la
 * migración se niega con 409 y la lista, sin tocar nada: un ADD CONSTRAINT que
 * revienta por datos deja la tabla sin guarda si no está en transacción, y con
 * transacción revienta la corrida entera sin decir cuáles fueron. Contar primero
 * dice CUÁLES.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_PRECIO = "events_door_price_check";
const CHECK_ORDEN = "events_fin_despues_de_inicio_check";
const CHECK_ROL = "edit_log_actor_rol_check";

const DEF_PRECIO = `CHECK (((door_price_cop IS NULL) OR (door_price_cop >= 0)))`;
const DEF_ORDEN =
  `CHECK (((end_at IS NULL) OR (starts_at IS NULL) OR (end_at > starts_at)))`;
/**
 * 'moderador' se AGREGA AL FINAL y los otros tres no se mueven. El orden del
 * ARRAY es parte de la definición que pg_get_constraintdef devuelve, así que
 * reordenarlos sería un diff más grande sin ninguna ganancia.
 *
 * Y el valor hace falta porque un MODERATOR no es ninguno de los tres que había:
 * rolSobreColectivo le devolvía null y registrarEdicion no escribía NADA. Sus
 * ediciones eran invisibles, en silencio.
 */
const DEF_ROL =
  `CHECK ((actor_rol = ANY (ARRAY['dueno'::text, 'residente'::text, 'super_admin'::text, 'moderador'::text])))`;

type Columna = { tipo: string; aceptaNull: boolean; default: string | null };
type Estado = {
  startsAt: Columna | null;
  checksEvents: string[];
  checksEditLog: string[];
  conteos: Record<string, number>;
};

function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const p: string[] = [];

  if (!e.startsAt) {
    p.push("falta events.starts_at");
  } else {
    if (!/timestamp with time zone/i.test(e.startsAt.tipo)) {
      p.push(`events.starts_at EXISTE PERO es ${e.startsAt.tipo} y se esperaba timestamptz`);
    }
    if (!e.startsAt.aceptaNull) {
      p.push('events.starts_at es NOT NULL y tiene que aceptar NULL ("no dijo hora")');
    }
    if (e.startsAt.default !== null) {
      p.push(
        `events.starts_at tiene default ${e.startsAt.default} y NO debe tener ninguno: ` +
          'un default convertiría "no dijo hora" en una hora'
      );
    }
  }

  const exacto = (lista: string[], nombre: string, esperado: string) => {
    const linea = lista.find((x) => x.startsWith(`${nombre}: `));
    if (!linea) {
      p.push(`falta el CHECK ${nombre}`);
      return;
    }
    const real = linea.slice(nombre.length + 2);
    if (real !== esperado) {
      p.push(
        `el CHECK ${nombre} EXISTE PERO tiene otra definición.\n      es:      ${real}\n      debería: ${esperado}`
      );
    }
  };
  exacto(e.checksEvents, CHECK_PRECIO, DEF_PRECIO);
  exacto(e.checksEvents, CHECK_ORDEN, DEF_ORDEN);
  exacto(e.checksEditLog, CHECK_ROL, DEF_ROL);

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

  /** Las filas que el CHECK de orden rechazaría. Se mide siempre, en los dos caminos. */
  const violaciones = async (): Promise<{ id: number; starts_at: string; end_at: string }[]> => {
    const [existe] = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'events' AND column_name = 'starts_at'`;
    if (!existe) return [];
    return (await sql`
      SELECT id, starts_at::text AS starts_at, end_at::text AS end_at
      FROM events
      WHERE starts_at IS NOT NULL AND end_at IS NOT NULL AND end_at <= starts_at
      ORDER BY id
    `) as { id: number; starts_at: string; end_at: string }[];
  };

  const estado = async (): Promise<Estado> => {
    const cols = await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'starts_at'`;
    const chEvents = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'events'::regclass AND contype = 'c' ORDER BY conname`;
    const chEditLog = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'edit_log'::regclass AND contype = 'c' ORDER BY conname`;

    const [total] = await sql`SELECT COUNT(*)::int AS n FROM events`;
    const [conFin] = await sql`SELECT COUNT(*)::int AS n FROM events WHERE end_at IS NOT NULL`;
    let conHora = 0;
    if (cols.length > 0) {
      const [c] = await sql`SELECT COUNT(*)::int AS n FROM events WHERE starts_at IS NOT NULL`;
      conHora = c.n as number;
    }
    const [filasLog] = await sql`SELECT COUNT(*)::int AS n FROM edit_log`;

    return {
      startsAt:
        cols.length === 0
          ? null
          : {
              tipo: cols[0].data_type as string,
              aceptaNull: cols[0].is_nullable === "YES",
              default: (cols[0].column_default as string | null) ?? null,
            },
      checksEvents: chEvents.map((c) => `${c.conname}: ${c.def}`),
      checksEditLog: chEditLog.map((c) => `${c.conname}: ${c.def}`),
      conteos: {
        eventos: total.n as number,
        con_hora_inicio: conHora,
        con_hora_fin: conFin.n as number,
        filas_edit_log: filasLog.n as number,
      },
    };
  };

  try {
    const antes = await estado();
    const malas = await violaciones();

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está todo con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s).`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);

      /**
       * EL CONTEO QUE PEDISTE, y va en el dryRun para poder verlo ANTES de decidir.
       * Con starts_at recién nacida en NULL esto es 0 por construcción; deja de ser
       * trivial en una re-corrida, cuando ya haya horas cargadas.
       */
      log.push(
        malas.length === 0
          ? "CHECK fin > inicio: CERO eventos lo violarían. Se puede agregar sin riesgo."
          : `CHECK fin > inicio: ${malas.length} evento(s) LO VIOLARÍAN. La corrida real se va a negar.`
      );
      for (const m of malas) {
        log.push(`  - evento ${m.id}: empieza ${m.starts_at} y termina ${m.end_at}`);
      }

      log.push("SIN BACKFILL: los eventos que ya existen quedan con starts_at en NULL, o sea sin hora.");
      log.push("SIN DEFAULT: un default le inventaría una hora a cada evento viejo.");
      log.push("NO hay CHECK que ate starts_at a event_date: dependería de la zona y además sería");
      log.push("  falso, porque una fiesta del 15 que arranca a la 1:00 empieza el 16.");
      log.push(`Conteos: ${JSON.stringify(antes.conteos)}. con_hora_inicio no puede cambiar.`);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        violacionesDelOrden: malas.length,
        filasQueViolan: malas,
        problemas: v.problemas,
        estado: antes,
        log,
      });
    }

    /**
     * LA GUARDA VA EN LOS DOS CAMINOS. Si alguna fila violaría el CHECK de orden,
     * no se toca NADA: ni la columna, ni los otros dos CHECK. Una migración que
     * aplica tres de cuatro cosas y falla en la cuarta deja un estado que nadie
     * eligió y que hay que averiguar.
     */
    if (malas.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          verificado: false,
          error:
            `HAY ${malas.length} evento(s) donde end_at <= starts_at, así que el CHECK de ` +
            "fin > inicio no se puede agregar. No se tocó nada. Corregí esos eventos y volvé.",
          filasQueViolan: malas,
          log,
        },
        { status: 409 }
      );
    }

    /**
     * ============================================================
     * LOS CUATRO CAMBIOS EN UNA SOLA TRANSACCIÓN
     * ============================================================
     *
     * La primera versión hacía el ADD COLUMN suelto y después tres transacciones
     * independientes, una por swap. Cada swap era atómico —así que ningún CHECK
     * preexistente se podía perder— pero el CONJUNTO no lo era, y el reviewer
     * encontró la secuencia: el ADD COLUMN commitea, el swap del precio commitea,
     * el del orden falla por un timeout o un corte, y el catch devuelve un 500
     * genérico. Producción queda con starts_at SIN su guarda de end_at > starts_at
     * por tiempo indefinido, y el response no dice cuáles de los cuatro entraron.
     *
     * Postgres tiene DDL transaccional, incluso entre tablas distintas, así que
     * los cuatro van juntos: o queda todo o no queda nada. Y el orden importa
     * adentro —la columna antes del CHECK que la nombra— lo cual esta forma
     * garantiza, porque las sentencias de una transacción corren en orden.
     *
     * Los ADD van desnudos, sin el envoltorio DO $$ EXCEPTION WHEN
     * duplicate_object $$: después de un DROP IF EXISTS del mismo nombre no queda
     * nada que duplicar, así que ese handler solo podría tragarse un error real.
     */
    await sql.transaction([
      sql(`ALTER TABLE events ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ`),
      sql(`ALTER TABLE events DROP CONSTRAINT IF EXISTS ${CHECK_PRECIO}`),
      sql(`ALTER TABLE events ADD CONSTRAINT ${CHECK_PRECIO} ${DEF_PRECIO}`),
      sql(`ALTER TABLE events DROP CONSTRAINT IF EXISTS ${CHECK_ORDEN}`),
      sql(`ALTER TABLE events ADD CONSTRAINT ${CHECK_ORDEN} ${DEF_ORDEN}`),
      sql(`ALTER TABLE edit_log DROP CONSTRAINT IF EXISTS ${CHECK_ROL}`),
      sql(`ALTER TABLE edit_log ADD CONSTRAINT ${CHECK_ROL} ${DEF_ROL}`),
    ]);

    const despues = await estado();
    const v = verificarForma(despues);
    log.push(
      v.ok
        ? "VERIFICADO: events.starts_at es timestamptz, acepta NULL y no tiene default; " +
          "los tres CHECK tienen su definición exacta."
        : `NO VERIFICADO: ${v.problemas.length} problema(s).`
    );
    for (const x of v.problemas) log.push(`  - ${x}`);
    log.push(`CHECK fin > inicio agregado con ${malas.length} violaciones previas (tenía que ser 0).`);
    log.push("edit_log.actor_rol ahora acepta 'moderador': sus ediciones dejan de ser invisibles.");
    log.push("door_price_cop ya no tiene tope: el precio lo decide el organizador.");

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
      violacionesDelOrden: malas.length,
      problemas: v.problemas,
      antes,
      despues,
      log,
    });
  } catch (e) {
    /**
     * EL CATCH MIDE QUÉ QUEDÓ, no solo dice que algo falló.
     *
     * Con los cuatro cambios en una transacción esto debería ser "nada quedó",
     * pero afirmarlo sin mirar es exactamente lo que este repo tiene prohibido: un
     * log que afirma sin verificar es peor que no loguear. Así que se vuelve a
     * medir y se devuelve la forma real, para que el que lea el error sepa si
     * tiene que volver a correrla o si hay algo a mano que arreglar.
     *
     * Si la medición TAMBIÉN falla —la base no contesta— se dice eso en vez de
     * tragarse el segundo error y dejar el primero solo.
     */
    let despues: Estado | null = null;
    let problemaAlMedir: string | null = null;
    try {
      despues = await estado();
    } catch (e2) {
      problemaAlMedir = e2 instanceof Error ? e2.message : String(e2);
    }
    if (despues) {
      const v = verificarForma(despues);
      log.push(
        v.ok
          ? "Pero al volver a medir, la forma está COMPLETA: la transacción alcanzó a aplicarse."
          : `Al volver a medir quedan ${v.problemas.length} cosa(s) sin aplicar. Re-correr esto es seguro.`
      );
      for (const x of v.problemas) log.push(`  - ${x}`);
    } else {
      log.push(`Y tampoco pude medir cómo quedó: ${problemaAlMedir}`);
    }

    return NextResponse.json(
      {
        ok: false,
        verificado: false,
        error: e instanceof Error ? e.message : String(e),
        estadoTrasElError: despues,
        log,
      },
      { status: 500 }
    );
  }
}
