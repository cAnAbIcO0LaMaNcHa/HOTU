/**
 * MIGRATION — TANDA 3, §6 (republicación) y §11 (likes a colectivos).
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-republication?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-republication?secret=YOUR_SECRET
 *
 * PURAMENTE ADITIVA. Tres tablas nuevas y dos columnas nuevas con
 * DEFAULT. Ninguna fila se borra, ninguna se reescribe, ningún
 * constraint existente se toca.
 *
 * SE PUEDE CORRER CON EL CÓDIGO ACTUAL DESPLEGADO. Nadie lee todavía
 * nada de esto, y las dos columnas nuevas nacen NOT NULL DEFAULT false,
 * así que los seis INSERT que ya existen sobre dj_sets y tracks —que
 * nombran sus columnas explícitamente— siguen andando sin cambios. No
 * hay ventana de error entre correr esto y desplegar.
 *
 * Las dos piezas van juntas en una sola migración a pedido: una corrida
 * contra main es menos superficie que dos, y los likes no dependen de
 * nada de la republicación.
 *
 * ============================================================
 * POR QUÉ LO VIVO NO SE GUARDA Y LO FIJO SÍ
 * ============================================================
 *
 * §6 dice que el contenido propio de un DJ aparece en su casa ACTUAL y
 * migra con él, y que el contenido con colaboradores queda FIJO donde se
 * publicó.
 *
 * Son dos tipos de hecho distintos, y por eso se guardan distinto:
 *
 *   "este track está en el colectivo X" NO es un hecho, es una
 *   derivación de "su autor tiene casa en X ahora". Guardar una
 *   derivación es lo que produce deriva: el día que el proceso que mueve
 *   las filas falle a mitad, media discografía queda en la casa vieja y
 *   nada en la base dice que está mal.
 *
 *   "este track se hizo con Fulana y Mengano" SÍ es un hecho, y uno
 *   histórico. No se deriva de nada. Si no se guarda, se pierde.
 *
 * Así que lo derivado se deriva —un JOIN contra la casa activa— y lo
 * registrado se registra. Por eso NO hay una tabla con una fila por cada
 * pieza y cada colectivo: el contenido vivo no tiene filas acá. Si las
 * tuviera, cambiar de casa obligaría a reescribirlas, que es exactamente
 * lo que artist_collectives ya decidió no hacer cuando estableció que el
 * histórico es inmutable —se cierra con to_date, no se borra.
 *
 * El costo de consulta NO es el argumento y conviene decirlo: los dos
 * diseños son baratos a esta escala. Lo que decide es la deriva.
 *
 * SALVEDAD SOBRE "SI NO SE GUARDA, SE PIERDE": el crédito se guarda
 * mientras exista la cuenta, no para siempre. artist_slug va ON DELETE
 * CASCADE, así que borrar a un artista se lleva su fila de colaborador y
 * no queda ni el nombre. SET NULL no es una alternativa: dejaría
 * artist_slug y collective_slug los dos en NULL y violaría el CHECK de
 * "exactamente un invitado", que es el mismo callejón de artist_gigs
 * (event_id va CASCADE porque SET NULL violaría su CHECK). Hoy no hay
 * ningún camino en el repo que borre un artista, así que no es
 * alcanzable; el día que se escriba, o se desnormaliza un nombre acá y
 * se relaja el CHECK, o se acepta que el crédito muere con la cuenta.
 * Queda dicho, no descubierto después.
 *
 * ============================================================
 * NADA DE ESTO ES POLIMÓRFICO, A PROPÓSITO
 * ============================================================
 *
 * La forma obvia sería (content_type, content_slug) con content_type
 * IN ('set','track'). No se puede: una columna polimórfica NO PUEDE
 * tener foreign key, y la convención del repo es que contra un slug el
 * FK con ON UPDATE CASCADE es obligatorio, porque son PKs de texto y
 * renombrar un slug sin cascade rompe todas las referencias. Sin FK,
 * borrar un set dejaría filas huérfanas apuntando a un slug que ya no
 * existe, y nada las detectaría.
 *
 * Así que van DOS columnas nullable —set_slug y track_slug— cada una con
 * su FK real, y un CHECK de "exactamente una". Misma forma para el
 * invitado, que puede ser un artista o un colectivo. Es más verboso y es
 * lo único que mantiene la integridad referencial.
 *
 * Consecuencia: los UNIQUE tienen que ser índices únicos PARCIALES con
 * WHERE ... IS NOT NULL. Un UNIQUE común no sirve, porque Postgres trata
 * cada NULL como distinto y (NULL, 'camila') se podría repetir.
 *
 * ============================================================
 * is_fixed ES REDUNDANTE Y VA IGUAL
 * ============================================================
 *
 * "Tiene colaboradores" ya se puede responder con un EXISTS contra
 * content_collaborators. La columna va igual por dos razones:
 *
 * 1. Es lo que hace que la consulta viva sea "AND NOT s.is_fixed" en vez
 *    de un anti-join contra otra tabla.
 * 2. Sin ella, una pieza fija se colaría por el camino vivo: aparecería
 *    DOS veces en su casa y además MIGRARÍA al cambiar de casa, que es
 *    justo lo que §6 prohíbe. La regla queda legible en la propia fila.
 *
 * Se escribe una vez al publicar y no se vuelve a tocar. Una pieza fija
 * no se desfija: sacar al último colaborador no la devuelve al camino
 * vivo, porque la colaboración ocurrió y el destino ya está congelado.
 *
 * ============================================================
 * LO QUE ESTE SCHEMA **NO** PUEDE HACER CUMPLIR
 * ============================================================
 *
 * La revisión encontró cuatro estados que el schema permite y las reglas
 * prohíben. Ninguno se puede expresar como CHECK —todos miran filas de
 * otra tabla— así que los hace cumplir el write path de §6, igual que la
 * casa-en-venue. Están anotados en PROGRESO.md como requisitos, no como
 * ideas:
 *
 * 1. UNA PIEZA is_fixed=true SIN NINGÚN PLACEMENT ES INVISIBLE EN TODAS
 *    PARTES. No entra por el camino vivo (la excluye is_fixed) ni por el
 *    fijo (no tiene filas). Publicar una colaboración son tres statements
 *    y cada sql del driver HTTP es su propio request: si el tercero
 *    falla, queda publicada e invisible para siempre, sin error en ningún
 *    log. El publicar va ENTERO en sql.transaction, y el admin necesita
 *    la consulta que detecta el estado huérfano.
 * 2. deleteCollective() —que ya existe y es un botón de admin— se lleva
 *    los placements por CASCADE y fabrica exactamente ese huérfano con un
 *    click. CASCADE es defendible (el destino dejó de existir), pero la
 *    consecuencia tiene que estar escrita y detectable.
 * 3. El INSERT de placement al aceptar necesita ON CONFLICT DO NOTHING:
 *    si el colaborador comparte casa con el autor, el único choca y la
 *    aceptación devuelve 500 después de que la persona ya dijo que sí.
 * 4. is_fixed=false CON placements sacaría la pieza dos veces (una por
 *    cada rama del UNION); y nada impide que el autor se invite a sí
 *    mismo, ni que el destino sea un venue.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLAS = ["collective_likes", "content_collaborators", "content_placements"];

/** Los diez índices que esta migración crea, por nombre. */
const INDICES = [
  "collective_likes_user_email_idx",
  "content_collaborators_set_artist_idx",
  "content_collaborators_set_collective_idx",
  "content_collaborators_track_artist_idx",
  "content_collaborators_track_collective_idx",
  "content_collaborators_artist_idx",
  "content_collaborators_collective_idx",
  "content_placements_set_idx",
  "content_placements_track_idx",
  "content_placements_collective_idx",
];

/** Los tres CHECK, con un fragmento que tiene que aparecer en su def. */
const CHECKS: Array<{ nombre: string; contiene: string }> = [
  { nombre: "content_collaborators_una_pieza_check", contiene: "set_slug" },
  { nombre: "content_collaborators_un_invitado_check", contiene: "artist_slug" },
  { nombre: "content_placements_una_pieza_check", contiene: "set_slug" },
];

type Estado = {
  tablas: string[];
  columnas: Array<{
    tabla: string;
    nombre: string;
    tipo: string;
    aceptaNull: boolean;
    default: string | null;
  }>;
  constraints: string[];
  indices: string[];
  filasExistentes: Record<string, number>;
  filasNuevas: Record<string, number>;
};

/**
 * ¿Quedó con la FORMA correcta, o solamente con el NOMBRE correcto?
 *
 * Corre en LOS DOS CAMINOS, dryRun y real. Antes vivía solo dentro del
 * dryRun, y el camino real se limitaba a un log.push incondicional que
 * afirmaba "is_fixed agregada (NOT NULL DEFAULT false)" pasara lo que
 * pasara. Eso es peor que no informar: el JSON decía una cosa y el log
 * la contraria, y la gente lee el log.
 *
 * Verifica forma y no existencia porque CREATE TABLE / CREATE INDEX /
 * ADD COLUMN con IF NOT EXISTS comparan por NOMBRE. Si ya existiera una
 * is_fixed nullable, el ADD COLUMN se saltea en silencio, cada fila
 * nueva nace NULL, y "AND NOT is_fixed" con NULL evalúa a NULL y no a
 * true: la pieza desaparece de la casa de su autor sin un solo error.
 * Y una is_fixed NOT NULL DEFAULT **true** preexistente pasaría
 * cualquier chequeo que solo mire "¿es NOT NULL y tiene default?", así
 * que acá se compara el default contra false explícitamente.
 */
function verificarForma(e: Estado): { ok: boolean; problemas: string[] } {
  const problemas: string[] = [];

  for (const t of TABLAS) {
    if (!e.tablas.includes(t)) problemas.push(`falta la tabla ${t}`);
  }

  for (const tabla of ["dj_sets", "tracks"]) {
    const c = e.columnas.find((x) => x.tabla === tabla && x.nombre === "is_fixed");
    if (!c) {
      problemas.push(`falta ${tabla}.is_fixed`);
      continue;
    }
    if (c.aceptaNull) problemas.push(`${tabla}.is_fixed acepta NULL`);
    if (c.default === null || !/false/i.test(c.default)) {
      problemas.push(`${tabla}.is_fixed tiene default ${c.default ?? "ninguno"}, se esperaba false`);
    }
    if (!/bool/i.test(c.tipo)) problemas.push(`${tabla}.is_fixed es ${c.tipo}, se esperaba boolean`);
  }

  for (const i of INDICES) {
    if (!e.indices.some((x) => x.includes(`.${i}:`))) problemas.push(`falta el índice ${i}`);
  }

  for (const ch of CHECKS) {
    const linea = e.constraints.find((x) => x.includes(`.${ch.nombre}:`));
    if (!linea) problemas.push(`falta el CHECK ${ch.nombre}`);
    else if (!linea.includes(ch.contiene)) {
      problemas.push(`el CHECK ${ch.nombre} existe pero no menciona ${ch.contiene}: ${linea}`);
    }
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
    const tablas = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${TABLAS}::text[])
      ORDER BY table_name
    `;
    const columnas = await sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = ANY(${TABLAS}::text[]))
             OR (table_name IN ('dj_sets', 'tracks') AND column_name = 'is_fixed'))
      ORDER BY table_name, ordinal_position
    `;
    const constraints = await sql`
      SELECT t.relname AS tabla, c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = ANY(${TABLAS}::text[])
      ORDER BY 1, 2
    `;
    const indices = await sql`
      SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY(${TABLAS}::text[])
      ORDER BY tablename, indexname
    `;
    const [sets] = await sql`SELECT COUNT(*)::int AS n FROM dj_sets`;
    const [tracks] = await sql`SELECT COUNT(*)::int AS n FROM tracks`;
    const [likes] = await sql`SELECT COUNT(*)::int AS n FROM artist_likes`;

    // Sin interpolar el nombre de tabla en un string: la llamada por
    // función del driver no está documentada como estable y, si un bump
    // de minor exigiera tagged templates, esto rompería DESPUÉS de haber
    // aplicado el DDL y devolvería ok:false sobre una migración que en
    // realidad salió bien. Tres consultas fijas no tienen ese problema.
    const filasNuevas: Record<string, number> = {};
    const presentes = tablas.map((r) => r.table_name as string);
    if (presentes.includes("collective_likes")) {
      const [r] = await sql`SELECT COUNT(*)::int AS n FROM collective_likes`;
      filasNuevas.collective_likes = r.n as number;
    }
    if (presentes.includes("content_collaborators")) {
      const [r] = await sql`SELECT COUNT(*)::int AS n FROM content_collaborators`;
      filasNuevas.content_collaborators = r.n as number;
    }
    if (presentes.includes("content_placements")) {
      const [r] = await sql`SELECT COUNT(*)::int AS n FROM content_placements`;
      filasNuevas.content_placements = r.n as number;
    }

    return {
      tablas: presentes,
      columnas: columnas.map((c) => ({
        tabla: c.table_name as string,
        nombre: c.column_name as string,
        tipo: c.data_type as string,
        aceptaNull: c.is_nullable === "YES",
        default: (c.column_default as string | null) ?? null,
      })),
      constraints: constraints.map((c) => `${c.tabla}.${c.conname}: ${c.def}`),
      indices: indices.map((r) => `${r.tablename}.${r.indexname}: ${r.indexdef}`),
      filasExistentes: {
        dj_sets: sets.n as number,
        tracks: tracks.n as number,
        artist_likes: likes.n as number,
      },
      filasNuevas,
    };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const v = verificarForma(antes);
      const faltan = TABLAS.filter((t) => !antes.tablas.includes(t));
      log.push(
        faltan.length === 0
          ? "SIMULACIÓN: las tres tablas ya existen."
          : `SIMULACIÓN: se crearían ${faltan.length} tablas (${faltan.join(", ")})`
      );
      if (v.ok) {
        log.push("SIMULACIÓN: ya está todo con la forma correcta. Correrla no cambiaría nada.");
      } else {
        log.push(`SIMULACIÓN: falta o está mal ${v.problemas.length} cosa(s). Detalle en 'problemas'.`);
        for (const p of v.problemas) log.push(`  - ${p}`);
        log.push(
          "OJO: lo que diga 'existe pero' NO lo arregla correr esto. IF NOT EXISTS compara por nombre y se saltea en silencio. Hay que corregirlo a mano."
        );
      }
      log.push(
        `SIMULACIÓN: no se toca ninguna fila existente (dj_sets ${antes.filasExistentes.dj_sets}, tracks ${antes.filasExistentes.tracks}, artist_likes ${antes.filasExistentes.artist_likes}).`
      );
      return NextResponse.json({
        ok: true,
        dryRun: true,
        verificado: v.ok,
        problemas: v.problemas,
        log,
        estado: antes,
      });
    }

    // ---------------------------------------------------------------
    // 1. collective_likes — §11. Espejo exacto de artist_likes.
    //
    // Tabla propia y no una `likes(entity_type, entity_id)` genérica,
    // por lo mismo de arriba: una columna polimórfica no puede tener FK.
    // Los venues salen gratis, porque comparten la tabla collectives.
    // La PK compuesta ya da un like por usuario por colectivo.
    // ---------------------------------------------------------------
    await sql`
      CREATE TABLE IF NOT EXISTS collective_likes (
        collective_slug TEXT NOT NULL
          REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        user_email TEXT NOT NULL
          REFERENCES user_profiles(email) ON UPDATE CASCADE ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (collective_slug, user_email)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS collective_likes_user_email_idx
      ON collective_likes (user_email)
    `;

    // ---------------------------------------------------------------
    // 2. content_collaborators — §6.1. Quién colabora en qué.
    //
    // Los CHECK van INLINE dentro del CREATE TABLE, no por ALTER TABLE
    // ADD CONSTRAINT. Inline son idempotentes solos: si la tabla existe,
    // el IF NOT EXISTS saltea todo y no hay nada que duplicar. Por eso
    // acá no hace falta ningún envoltorio DO $$ ... duplicate_object $$,
    // y como no hay un solo DROP CONSTRAINT, tampoco hay swap que
    // envolver en sql.transaction.
    //
    // declined_at existe para que RECHAZAR no sea BORRAR. Sin ella el
    // rechazo tendría que borrar la fila, y ahí el índice único deja de
    // proteger: el autor puede volver a invitar infinitas veces a alguien
    // que ya dijo que no. Es la misma forma que artist_collectives, que
    // cierra con to_date en vez de borrar porque el histórico es
    // inmutable. Por eso los únicos parciales excluyen las rechazadas:
    // una invitación rechazada se conserva, y se puede volver a invitar
    // una vez, no infinitas.
    // ---------------------------------------------------------------
    await sql`
      CREATE TABLE IF NOT EXISTS content_collaborators (
        id SERIAL PRIMARY KEY,
        set_slug TEXT
          REFERENCES dj_sets(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        track_slug TEXT
          REFERENCES tracks(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        artist_slug TEXT
          REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        collective_slug TEXT
          REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at TIMESTAMPTZ,
        declined_at TIMESTAMPTZ,
        CONSTRAINT content_collaborators_una_pieza_check
          CHECK ((set_slug IS NULL) <> (track_slug IS NULL)),
        CONSTRAINT content_collaborators_un_invitado_check
          CHECK ((artist_slug IS NULL) <> (collective_slug IS NULL))
      )
    `;

    // Cuatro índices únicos PARCIALES y no un UNIQUE de cuatro columnas:
    // Postgres trata cada NULL como distinto, así que un UNIQUE común
    // dejaría repetir (NULL, NULL, 'camila', NULL) todas las veces que
    // quiera y la misma persona entraría invitada N veces a la misma
    // pieza.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS content_collaborators_set_artist_idx
      ON content_collaborators (set_slug, artist_slug)
      WHERE set_slug IS NOT NULL AND artist_slug IS NOT NULL AND declined_at IS NULL
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS content_collaborators_set_collective_idx
      ON content_collaborators (set_slug, collective_slug)
      WHERE set_slug IS NOT NULL AND collective_slug IS NOT NULL AND declined_at IS NULL
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS content_collaborators_track_artist_idx
      ON content_collaborators (track_slug, artist_slug)
      WHERE track_slug IS NOT NULL AND artist_slug IS NOT NULL AND declined_at IS NULL
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS content_collaborators_track_collective_idx
      ON content_collaborators (track_slug, collective_slug)
      WHERE track_slug IS NOT NULL AND collective_slug IS NOT NULL AND declined_at IS NULL
    `;
    // Para la bandeja: "qué invitaciones tengo pendientes".
    await sql`
      CREATE INDEX IF NOT EXISTS content_collaborators_artist_idx
      ON content_collaborators (artist_slug) WHERE artist_slug IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS content_collaborators_collective_idx
      ON content_collaborators (collective_slug) WHERE collective_slug IS NOT NULL
    `;

    // ---------------------------------------------------------------
    // 3. content_placements — el destino CONGELADO de una pieza fija.
    //
    // NO hay columna "frozen". Todas las filas de esta tabla son
    // congeladas por definición: el contenido vivo no tiene filas acá,
    // se deriva. Una columna que siempre vale lo mismo no informa nada y
    // el día que alguien la ponga en false abre un estado que el modelo
    // no tiene.
    //
    // Tampoco hay UPDATE previsto. Se escribe al publicar (el destino del
    // autor) y al aceptar (el de cada colaborador), cada fila con la casa
    // que esa parte tenía EN ESE MOMENTO, y no se vuelve a tocar.
    //
    // Una fila NO es atribuible: (T, 'reisen') no dice si la puso el
    // autor o quien aceptó. Es consecuencia de que dos partes puedan
    // compartir casa, y es aceptable porque los placements no se borran
    // nunca. Lo que sí implica: sacar a un colaborador jamás va a poder
    // limpiar placements, ni aunque se quisiera.
    // ---------------------------------------------------------------
    await sql`
      CREATE TABLE IF NOT EXISTS content_placements (
        id SERIAL PRIMARY KEY,
        set_slug TEXT
          REFERENCES dj_sets(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        track_slug TEXT
          REFERENCES tracks(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        collective_slug TEXT NOT NULL
          REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT content_placements_una_pieza_check
          CHECK ((set_slug IS NULL) <> (track_slug IS NULL))
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS content_placements_set_idx
      ON content_placements (set_slug, collective_slug)
      WHERE set_slug IS NOT NULL
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS content_placements_track_idx
      ON content_placements (track_slug, collective_slug)
      WHERE track_slug IS NOT NULL
    `;
    // El índice que sostiene la consulta del perfil del colectivo: "dame
    // lo fijo que vive acá".
    await sql`
      CREATE INDEX IF NOT EXISTS content_placements_collective_idx
      ON content_placements (collective_slug)
    `;

    // ---------------------------------------------------------------
    // 4. is_fixed en las dos tablas de contenido.
    //
    // NOT NULL DEFAULT false: todo lo que ya existe queda vivo, que es
    // lo correcto — nada de lo publicado hasta hoy tiene colaboradores,
    // porque hasta hoy no se podían invitar. En PG 17 agregar una
    // columna NOT NULL con default no volátil es metadata-only, así que
    // no reescribe la tabla.
    // ---------------------------------------------------------------
    await sql`ALTER TABLE dj_sets ADD COLUMN IF NOT EXISTS is_fixed BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE tracks  ADD COLUMN IF NOT EXISTS is_fixed BOOLEAN NOT NULL DEFAULT false`;

    const despues = await estado();
    const v = verificarForma(despues);

    // El log NO afirma nada que no haya mirado. Antes decía "is_fixed
    // agregada (NOT NULL DEFAULT false)" de forma incondicional, incluso
    // cuando el ADD COLUMN se había salteado por nombre sobre una columna
    // con otra forma.
    if (v.ok) {
      log.push(
        "VERIFICADO: las 3 tablas, los 10 índices, los 3 CHECK y las 2 columnas is_fixed quedaron con la forma esperada."
      );
    } else {
      log.push(`NO VERIFICADO: ${v.problemas.length} problema(s). Detalle en 'problemas'.`);
      for (const p of v.problemas) log.push(`  - ${p}`);
      log.push(
        "Lo que diga 'existe pero' NO se arregla volviendo a correr esto: IF NOT EXISTS compara por nombre. Hay que corregirlo a mano."
      );
    }

    // Esto NO prueba que la migración sea aditiva —no escribe una sola
    // fila, así que solo podría cambiar si alguien escribió en paralelo—.
    // Se informa como lo que es: un testigo, no una demostración.
    const igual =
      antes.filasExistentes.dj_sets === despues.filasExistentes.dj_sets &&
      antes.filasExistentes.tracks === despues.filasExistentes.tracks &&
      antes.filasExistentes.artist_likes === despues.filasExistentes.artist_likes;
    if (!igual) {
      log.push(
        "ATENCIÓN: cambió el conteo de una tabla existente durante la corrida. Esta migración no escribe filas, así que fue otra cosa. Revisar."
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      verificado: v.ok,
      problemas: v.problemas,
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
