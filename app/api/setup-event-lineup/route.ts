/**
 * MIGRATION — TANDA 3, §7: la relación evento ↔ organizador ↔ lineup.
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-event-lineup?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-event-lineup?secret=YOUR_SECRET
 *
 * PURAMENTE ADITIVA. Una tabla nueva y dos columnas nuevas nullable.
 * Ninguna fila se borra, ninguna se reescribe, `events.lineup` NO SE
 * TOCA. Esta ruta crea la estructura y nada más: el import del texto
 * libre es un paso aparte, con su propio reporte, para que crear el
 * schema y decidir qué significa cada nombre no ocurran en el mismo
 * click.
 *
 * SE PUEDE CORRER CON EL CÓDIGO ACTUAL DESPLEGADO. Nadie lee todavía
 * nada de esto, y las dos columnas nuevas son nullable, así que los
 * INSERT que ya existen sobre `events` —que nombran sus columnas
 * explícitamente— siguen andando sin cambios.
 *
 * ============================================================
 * POR QUÉ NO ALCANZA CON artist_gigs
 * ============================================================
 *
 * artist_gigs es casi exactamente esto: tiene event_id, role, b2b_with y
 * duration_minutes, y su índice único parcial (artist_slug, event_id)
 * existe, según AGENTS.md, "para que el importador de lineups no duplique
 * toques". El importador estaba previsto ahí.
 *
 * Pero artist_slug es NOT NULL, y los lineups reales no son solo
 * artistas. Medido contra los datos, no supuesto: de siete entradas,
 * CINCO son colectivos —Paramo Club, HOTU 138, Subsuelo DJs, HOTU
 * Residents, Chía Underground— y dos son artistas. Así funcionan los
 * flyers: una crew toma un bloque b2b. Un lineup con un colectivo, o con
 * un nombre que no corresponde a nadie, no entra en artist_gigs. No es
 * que se prefiera otra tabla: no cabe.
 *
 * artist_gigs se queda con los toques DECLARADOS, que son los que no
 * tienen un evento en la base. Los de source='hotu' dejan de leerse de
 * ahí y pasan a salir de event_lineup — el mismo patrón de los jsonb y
 * de district: primero se deja de leer, la columna queda congelada, y se
 * borra mucho después. Esta migración NO toca una sola fila de
 * artist_gigs; solo reporta cuántas hay.
 *
 * ============================================================
 * raw_name ES OBLIGATORIO Y LA RESOLUCIÓN ES OPCIONAL
 * ============================================================
 *
 * Esto se apartó del plan aprobado, que decía "artist_slug O
 * collective_slug O raw_name, exactamente uno". Sale mejor así:
 *
 *   raw_name NOT NULL      — el texto como aparecía en el flyer, SIEMPRE
 *   artist_slug nullable   — a quién se resolvió, si se resolvió
 *   collective_slug nullable
 *   CHECK: no los dos a la vez
 *
 * Tres cosas que el diseño anterior no daba:
 *
 * 1. CADA ENTRADA CONSERVA SU TEXTO, no solo las que no resolvieron. Si
 *    mañana alguien duda de una asignación, el original está al lado.
 * 2. "FALTA REVISAR" ES UNA CONSULTA, no una convención: artist_slug IS
 *    NULL AND collective_slug IS NULL.
 * 3. ON DELETE SET NULL FUNCIONA. Con el CHECK de "exactamente uno",
 *    borrar un artista habría dejado las tres columnas en NULL y violado
 *    el CHECK —el mismo callejón de artist_gigs, donde event_id va
 *    CASCADE porque SET NULL violaría el suyo—. Acá SET NULL degrada la
 *    entrada a texto suelto, que es justo lo que querríamos que pasara:
 *    el nombre sigue en el lineup, sin vínculo.
 *
 * ============================================================
 * EL ORGANIZADOR NO SALE DEL TEXTO
 * ============================================================
 *
 * En el lineup no está, y en events no hay columna. Los eventos que ya
 * existen se asignan A MANO. Por eso organizer_slug es nullable: un
 * evento sin organizador tiene que poder existir, porque hoy TODOS lo
 * son.
 *
 * ON DELETE RESTRICT y no SET NULL: un colectivo borrado no puede dejar
 * sus eventos sin organizador en silencio, porque las métricas de §4.4
 * se calculan sobre eso y bajarían sin que nadie se entere.
 * deleteCollective ya se niega por content_placements; suma los eventos
 * organizados a la misma negativa.
 *
 * ============================================================
 * UN VENUE NO TOCA EN UN LINEUP — LO HACE CUMPLIR EL IMPORT
 * ============================================================
 *
 * collective_slug referencia collectives(slug), que desde setup-venues
 * guarda colectivos Y venues. Nada en el schema impide poner un venue
 * como intérprete, y NO es hipotético: los flyers nombran el lugar, y
 * events.venue es texto libre, así que un import descuidado resolvería
 * "Bodega 38" contra el venue y le contaría un toque que nunca dio.
 *
 * El import tiene que filtrar entity_kind = 'collective' al resolver. Es
 * la misma clase de regla que la casa-en-venue: un CHECK no puede
 * consultar otra fila, así que vive en el camino de escritura. Queda
 * dicho acá porque el schema solo no alcanza para hacerla cumplir.
 *
 * Un venue como ORGANIZADOR sí vale, y por eso organizer_slug apunta a
 * la misma tabla sin filtrar: §5 le da eventos y métricas propias.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cada índice con lo que su DEFINICIÓN tiene que decir, no solo su
 * nombre.
 *
 * Comparar por nombre era el agujero: CREATE INDEX IF NOT EXISTS ya
 * compara por nombre, así que un índice preexistente que se llame igual
 * y tenga otra forma se saltea en silencio Y pasa la verificación. El
 * caso concreto: un event_lineup_event_artist_idx que NO sea único
 * dejaría meter dos veces al mismo artista en el mismo evento, y la
 * métrica de §4.4 contaría el toque doble.
 */
const INDICES: Array<{ nombre: string; debe: RegExp[] }> = [
  { nombre: "event_lineup_event_idx", debe: [/event_id/, /position/] },
  { nombre: "event_lineup_artist_idx", debe: [/artist_slug/, /WHERE .*artist_slug IS NOT NULL/i] },
  {
    nombre: "event_lineup_collective_idx",
    debe: [/collective_slug/, /WHERE .*collective_slug IS NOT NULL/i],
  },
  {
    nombre: "event_lineup_event_artist_idx",
    debe: [/UNIQUE INDEX/i, /event_id/, /artist_slug/, /WHERE .*artist_slug IS NOT NULL/i],
  },
  {
    nombre: "event_lineup_event_collective_idx",
    debe: [/UNIQUE INDEX/i, /event_id/, /collective_slug/, /WHERE .*collective_slug IS NOT NULL/i],
  },
  {
    nombre: "event_lineup_sin_resolver_idx",
    debe: [/UNIQUE INDEX/i, /event_id/, /lower\(raw_name\)/i, /artist_slug IS NULL/i],
  },
  {
    nombre: "events_organizer_idx",
    debe: [/organizer_slug/, /WHERE .*organizer_slug IS NOT NULL/i],
  },
];

const CHECKS: Array<{ nombre: string; debe: RegExp[] }> = [
  {
    nombre: "event_lineup_un_vinculo_check",
    debe: [/artist_slug IS NULL/i, /collective_slug IS NULL/i, /OR/i],
  },
];

/**
 * Los cuatro FK, con sus acciones exactas.
 *
 * El de artist_slug NO estaba verificado, y es el pilar de todo el
 * diseño: si fuera CASCADE en vez de SET NULL, borrar un artista se
 * llevaría la entrada entera del lineup —el nombre desaparecería del
 * flyer— en vez de degradarla a texto suelto.
 */
const FKS: Array<{ columna: string; debe: RegExp[] }> = [
  { columna: "event_id", debe: [/REFERENCES events\(id\)/i, /ON DELETE CASCADE/i] },
  {
    columna: "artist_slug",
    debe: [/REFERENCES artists\(slug\)/i, /ON UPDATE CASCADE/i, /ON DELETE SET NULL/i],
  },
  {
    columna: "collective_slug",
    debe: [/REFERENCES collectives\(slug\)/i, /ON UPDATE CASCADE/i, /ON DELETE SET NULL/i],
  },
  {
    columna: "organizer_slug",
    debe: [/REFERENCES collectives\(slug\)/i, /ON UPDATE CASCADE/i, /ON DELETE RESTRICT/i],
  },
];

type Estado = {
  tablaLineup: boolean;
  columnas: Array<{
    tabla: string;
    nombre: string;
    tipo: string;
    aceptaNull: boolean;
    default: string | null;
  }>;
  constraints: string[];
  indices: string[];
  fks: string[];
  conteos: Record<string, number>;
  /** Qué toques 'hotu' hay hoy en artist_gigs, uno por uno. */
  gigsHotuDetalle: Array<{ artistSlug: string; eventId: number | null; titulo: string | null }>;
};

/**
 * ¿Quedó con la FORMA correcta, o solo con el NOMBRE correcto?
 *
 * Corre en LOS DOS caminos, dryRun y real, y devuelve `verificado`
 * aparte de `ok`. CREATE TABLE / CREATE INDEX / ADD COLUMN con IF NOT
 * EXISTS comparan por NOMBRE: si ya existe algo que se llama igual con
 * otra forma, el statement no hace nada, no falla, y la migración
 * devolvería ok:true sobre una base equivocada.
 */
function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const problemas: string[] = [];

  if (!e.tablaLineup) problemas.push("falta la tabla event_lineup");

  const exigido: Array<[string, string, boolean]> = [
    // tabla, columna, aceptaNull esperado
    ["event_lineup", "event_id", false],
    ["event_lineup", "raw_name", false],
    ["event_lineup", "artist_slug", true],
    ["event_lineup", "collective_slug", true],
    ["event_lineup", "position", false],
    ["events", "organizer_slug", true],
    ["events", "lineup_reviewed_at", true],
  ];
  for (const [tabla, columna, aceptaNull] of exigido) {
    const c = e.columnas.find((x) => x.tabla === tabla && x.nombre === columna);
    if (!c) {
      problemas.push(`falta ${tabla}.${columna}`);
      continue;
    }
    if (c.aceptaNull !== aceptaNull) {
      problemas.push(
        `${tabla}.${columna} ${c.aceptaNull ? "acepta NULL" : "es NOT NULL"}, se esperaba lo contrario`
      );
    }
  }

  // Los tres por DEFINICIÓN. "existe con este nombre" no es "quedó
  // bien", y es justo la diferencia que hace que una migración mienta.
  const revisar = (
    que: string,
    nombre: string,
    debe: RegExp[],
    donde: string[],
    buscar: (x: string) => boolean
  ) => {
    const linea = donde.find(buscar);
    if (!linea) {
      problemas.push(`falta ${que} ${nombre}`);
      return;
    }
    const faltan = debe.filter((r) => !r.test(linea));
    if (faltan.length > 0) {
      problemas.push(
        `${que} ${nombre} EXISTE PERO tiene otra forma (no se arregla volviendo a correr esto): ${linea}`
      );
    }
  };

  for (const i of INDICES) {
    revisar("el índice", i.nombre, i.debe, e.indices, (x) => x.includes(`.${i.nombre}:`));
  }
  for (const ch of CHECKS) {
    revisar("el CHECK", ch.nombre, ch.debe, e.constraints, (x) => x.includes(`.${ch.nombre}:`));
  }
  for (const f of FKS) {
    revisar("el FK de", f.columna, f.debe, e.fks, (x) =>
      new RegExp(`FOREIGN KEY \\(${f.columna}\\)`).test(x)
    );
  }

  return { ok: problemas.length === 0, problemas };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const estado = async (): Promise<Estado> => {
    const t = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'event_lineup'
    `;
    const columnas = await sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name = 'event_lineup'
             OR (table_name = 'events' AND column_name IN ('organizer_slug', 'lineup_reviewed_at')))
      ORDER BY table_name, ordinal_position
    `;
    const constraints = await sql`
      SELECT c2.relname AS tabla, c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class c2 ON c2.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = c2.relnamespace
      WHERE n.nspname = 'public' AND c2.relname IN ('event_lineup', 'events') AND c.contype = 'c'
      ORDER BY 1, 2
    `;
    const fks = await sql`
      SELECT c2.relname AS tabla, c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class c2 ON c2.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = c2.relnamespace
      WHERE n.nspname = 'public' AND c2.relname IN ('event_lineup', 'events') AND c.contype = 'f'
      ORDER BY 1, 2
    `;
    const indices = await sql`
      SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('event_lineup', 'events')
      ORDER BY tablename, indexname
    `;

    const [ev] = await sql`SELECT COUNT(*)::int AS n FROM events`;
    const [gigsHotu] = await sql`SELECT COUNT(*)::int AS n FROM artist_gigs WHERE source = 'hotu'`;
    /**
     * CUÁLES son, no cuántos.
     *
     * Un entero no sirve para lo que este reporte dice servir. El caso
     * que el número tapa: en dev la única fila con source='hotu' es
     * test-camila en el evento 4, y Camila NO está en el texto del
     * lineup de ese evento. Cuando la pieza siguiente deje de leer
     * artist_gigs, ese toque desaparece de su press kit, y un "1" no
     * avisa de eso. Con el detalle, se ve qué se pierde y de quién.
     */
    const gigsHotuDetalle = await sql`
      SELECT g.artist_slug, g.event_id, e.title
      FROM artist_gigs g
      LEFT JOIN events e ON e.id = g.event_id
      WHERE g.source = 'hotu'
      ORDER BY g.artist_slug, g.event_id
    `;
    const [gigsDecl] = await sql`
      SELECT COUNT(*)::int AS n FROM artist_gigs WHERE source = 'declarado'
    `;
    const tieneTabla = t.length > 0;
    let lineup = 0;
    if (tieneTabla) {
      const [l] = await sql`SELECT COUNT(*)::int AS n FROM event_lineup`;
      lineup = l.n as number;
    }

    return {
      tablaLineup: tieneTabla,
      columnas: columnas.map((c) => ({
        tabla: c.table_name as string,
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      constraints: constraints.map((c) => `${c.tabla}.${c.conname}: ${c.def}`),
      fks: fks.map((c) => `${c.tabla}.${c.conname}: ${c.def}`),
      indices: indices.map((r) => `${r.tablename}.${r.indexname}: ${r.indexdef}`),
      gigsHotuDetalle: gigsHotuDetalle.map((r) => ({
        artistSlug: r.artist_slug as string,
        eventId: (r.event_id as number | null) ?? null,
        titulo: (r.title as string | null) ?? null,
      })),
      conteos: {
        events: ev.n as number,
        event_lineup: lineup,
        artist_gigs_hotu: gigsHotu.n as number,
        artist_gigs_declarado: gigsDecl.n as number,
      },
    };
  };

  try {
    const antes = await estado();

    /**
     * EL NÚMERO QUE HAY QUE MIRAR ANTES DE SEGUIR.
     *
     * artist_gigs.source='hotu' son toques que hoy salen de esa tabla y
     * que van a pasar a salir de event_lineup. En main nunca hubo un
     * importador de lineups, así que se espera 0 o casi. Si el número es
     * alto, hay que averiguar de dónde salieron ANTES de construir nada
     * encima: esta migración no los toca, pero la pieza que sigue deja
     * de leerlos, y eso los haría desaparecer del press kit de alguien.
     */
    const hotu = antes.conteos.artist_gigs_hotu;
    log.push(
      hotu === 0
        ? "artist_gigs con source='hotu': 0. Nada que migrar después, como se esperaba — en main nunca hubo importador de lineups."
        : `ATENCIÓN — artist_gigs con source='hotu': ${hotu}. Esta migración NO los toca, pero la pieza siguiente deja de leerlos de ahí, y los que no queden representados en event_lineup DESAPARECEN del press kit de su artista. Cuáles son: ${antes.gigsHotuDetalle
            .map((g) => `${g.artistSlug} → evento ${g.eventId ?? "?"} (${g.titulo ?? "sin título"})`)
            .join(" · ")}`
    );

    if (dryRun) {
      const v = verificarForma(antes);
      log.push(
        v.ok
          ? "SIMULACIÓN: ya está todo con la forma correcta. Correrla no cambiaría nada."
          : `SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s). Detalle en 'problemas'.`
      );
      for (const p of v.problemas) log.push(`  - ${p}`);
      if (!v.ok) {
        log.push(
          "Los que dicen 'falta' los crea esta corrida. Los que dicen 'EXISTE PERO' NO: IF NOT EXISTS compara por nombre y se saltea en silencio, así que hay que corregirlos a mano."
        );
      }
      log.push(
        `SIMULACIÓN: no se toca ninguna fila. events ${antes.conteos.events}, events.lineup queda intacta.`
      );
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        gigsHotuAMigrarDespues: hotu,
        log,
        estado: antes,
      });
    }

    // ---------------------------------------------------------------
    // 1. event_lineup — quién toca en un evento, en orden.
    //
    // raw_name NOT NULL: el texto del flyer se conserva SIEMPRE, no solo
    // cuando no se pudo resolver. Y la resolución es opcional, así que
    // "falta revisar esta entrada" es una consulta y no una convención.
    //
    // Los CHECK van inline dentro del CREATE TABLE: son idempotentes
    // solos, porque si la tabla existe el IF NOT EXISTS saltea todo y no
    // queda nada que duplicar. No hace falta ningún envoltorio
    // DO $$ ... duplicate_object $$, y como no hay un solo DROP
    // CONSTRAINT, tampoco hay swap que envolver en sql.transaction.
    // ---------------------------------------------------------------
    await sql`
      CREATE TABLE IF NOT EXISTS event_lineup (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL
          REFERENCES events(id) ON DELETE CASCADE,
        raw_name TEXT NOT NULL,
        artist_slug TEXT
          REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE SET NULL,
        collective_slug TEXT
          REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE SET NULL,
        position INTEGER NOT NULL DEFAULT 0,
        role TEXT,
        b2b_with TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT event_lineup_un_vinculo_check
          CHECK (artist_slug IS NULL OR collective_slug IS NULL)
      )
    `;

    // Orden por position y después por id: position NO es único a
    // propósito. Hacerlo único obligaría a un valor temporal para
    // intercambiar dos entradas, que es una molestia sin beneficio —
    // dos entradas con la misma posición salen en orden de carga y no
    // rompen nada.
    await sql`
      CREATE INDEX IF NOT EXISTS event_lineup_event_idx
      ON event_lineup (event_id, position)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS event_lineup_artist_idx
      ON event_lineup (artist_slug) WHERE artist_slug IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS event_lineup_collective_idx
      ON event_lineup (collective_slug) WHERE collective_slug IS NOT NULL
    `;
    // Únicos PARCIALES, por lo mismo de siempre: un UNIQUE común trata
    // cada NULL como distinto, así que dejaría repetir (4, NULL) todas
    // las veces que quiera. Es el mismo motivo por el que artist_gigs
    // tiene su índice parcial (artist_slug, event_id).
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS event_lineup_event_artist_idx
      ON event_lineup (event_id, artist_slug) WHERE artist_slug IS NOT NULL
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS event_lineup_event_collective_idx
      ON event_lineup (event_id, collective_slug) WHERE collective_slug IS NOT NULL
    `;
    // Y el que faltaba: las entradas SIN resolver no las cubría ninguno
    // de los dos de arriba, porque los dos son parciales sobre "IS NOT
    // NULL". Sin este, correr el import dos veces —que es la regla del
    // repo— metía "HOTU Crew" dos veces sin un solo error: la falla de
    // siempre, no rompe, corrompe. Se agrega AHORA, que la tabla está
    // vacía y no hay nada que limpiar.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS event_lineup_sin_resolver_idx
      ON event_lineup (event_id, lower(raw_name))
      WHERE artist_slug IS NULL AND collective_slug IS NULL
    `;

    // ---------------------------------------------------------------
    // 2. El organizador y la marca de revisión, en events.
    //
    // Las dos nullable. organizer_slug porque hoy NINGÚN evento tiene
    // organizador y se asignan a mano; lineup_reviewed_at porque marca
    // un momento que todavía no ocurrió.
    // ---------------------------------------------------------------
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_slug TEXT`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS lineup_reviewed_at TIMESTAMPTZ`;

    // El FK va por ALTER TABLE, así que SÍ necesita el envoltorio: es lo
    // único acá que no está inline en un CREATE TABLE, y sin él la
    // segunda corrida fallaría con duplicate_object.
    await sql`
      DO $$ BEGIN
        ALTER TABLE events
          ADD CONSTRAINT events_organizer_fk
          FOREIGN KEY (organizer_slug) REFERENCES collectives(slug)
          ON UPDATE CASCADE ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS events_organizer_idx
      ON events (organizer_slug) WHERE organizer_slug IS NOT NULL
    `;

    const despues = await estado();
    const v = verificarForma(despues);

    if (v.ok) {
      log.push(
        "VERIFICADO: event_lineup, sus 5 índices, su CHECK, las 2 columnas de events y el FK RESTRICT del organizador quedaron con la forma esperada."
      );
    } else {
      log.push(`NO VERIFICADO: ${v.problemas.length} problema(s). Detalle en 'problemas'.`);
      for (const p of v.problemas) log.push(`  - ${p}`);
    }

    log.push(
      `events.lineup NO se tocó: sigue siendo la única prueba de qué decía el flyer. ${despues.conteos.events} eventos, ${despues.conteos.event_lineup} entradas de lineup (0 hasta que corra el import, que es otro paso).`
    );

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok,
      problemas: v.problemas,
      gigsHotuAMigrarDespues: hotu,
      log,
      antes,
      despues,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), log },
      { status: 500 }
    );
  }
}
