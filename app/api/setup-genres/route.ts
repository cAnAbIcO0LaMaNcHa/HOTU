/**
 * MIGRATION — TANDA 4, PIEZA 1: la taxonomía de géneros.
 *
 * Protegida con MIGRATE_SECRET:
 *   /api/setup-genres?secret=YOUR_SECRET&dryRun=1
 *   /api/setup-genres?secret=YOUR_SECRET
 *
 * PURAMENTE ADITIVA. Crea diez tablas nuevas y no toca ninguna existente.
 * En particular NO borra ni vacía las columnas `district`: dejarlas de
 * leer es la pieza 3, borrarlas es otra migración de otro día.
 *
 * Vocabulario:
 *   genre_branches        los 34 Main/Branch. PK: code de 3 letras.
 *   genre_tags            los tags. PK COMPUESTA (slug, branch_code).
 *   genre_aliases         alias de búsqueda -> branch canónico.
 *   cross_tags            era, contexto, formato, energía, tipo de DJ.
 *
 * Vínculos de perfil:
 *   artist_genres          branch primario + hasta 3 secundarios.
 *   artist_genre_tags      de 3 a 8 tags, los 3 primeros primarios.
 *   artist_cross_tags      los transversales.
 *   collective_genres      igual que artist_genres.
 *   collective_genre_tags  igual que artist_genre_tags.
 *   collective_cross_tags  igual que artist_cross_tags.
 *
 * POR QUÉ LA PK DEL TAG ES COMPUESTA. El documento dice que un mismo tag
 * puede aparecer en varios branches y que eso es intencional. Con slug
 * solo como PK, "Acid" existiría una vez y habría que elegirle un padre,
 * que es justo lo que §2.4 prohíbe: no inferir branch padre desde un tag
 * transversal. Con (slug, branch_code) el mismo tag cuelga de todos los
 * que lo usan y ninguno es el dueño.
 *
 * POR QUÉ TABLAS SEPARADAS PARA ARTISTA Y COLECTIVO. Son dos tablas con
 * PK de texto distintas. Una tabla de vínculo compartida no podría tener
 * un FK real contra las dos, y la convención del repo es FK reales
 * contra slug con ON UPDATE CASCADE. Seis tablas chicas cuestan menos
 * que perder la integridad referencial.
 *
 * QUÉ NO ES UN CHECK. "hasta 3 secundarios" y "de 3 a 8 tags" cuentan
 * filas hermanas, y un CHECK de Postgres no puede. Eso lo hace cumplir
 * el write path. Lo que SÍ es un índice es "un solo branch primario":
 * único parcial, igual que la casa de artist_collectives.
 *
 * ============================================================
 * DOS DECISIONES DE BORRADO, QUE NO SON SIMÉTRICAS
 * ============================================================
 *
 * De perfil hacia sus propios vínculos: CASCADE. Borrar un artista se
 * lleva sus géneros, que sin él no significan nada.
 *
 * De vocabulario hacia vocabulario: CASCADE. Borrar un branch se lleva
 * sus tags y sus alias, que son parte del mismo vocabulario.
 *
 * De vocabulario hacia PERFIL: **RESTRICT**. Un DELETE sobre un branch
 * que alguien está usando tiene que fallar ruidosamente, no vaciarle el
 * perfil a un DJ en silencio. Con CASCADE, re-sembrar la taxonomía —que
 * va a pasar, porque los códigos de hoy son provisionales— borraría en
 * cadena de dos niveles los tags elegidos por los usuarios, y un DJ que
 * tenía ese branch como primario quedaría con CERO primarios. El índice
 * único parcial impide dos, no puede detectar ninguno, así que el perfil
 * quedaría en un estado que las reglas prohíben y nadie se enteraría.
 * Es el mismo criterio que AGENTS.md ya aplica en tickets (RESTRICT
 * porque una boleta es prueba de un pago) y en dj_sets (SET NULL porque
 * desvincular se revierte y borrar no).
 *
 * ============================================================
 * UN TAG, UNA VEZ POR PERFIL
 * ============================================================
 *
 * La PK de artist_genre_tags es (artist_slug, tag_slug, branch_code), y
 * sola permitiría (camila, acid, TEC), (camila, acid, ACI) y
 * (camila, acid, IND) a la vez: tres filas válidas, tres de los ocho
 * cupos gastados en una sola palabra, y el EPK mostrando "Acid, Acid,
 * Acid". El índice único sobre (artist_slug, tag_slug) lo impide. La
 * regla "de 3 a 8 tags" cuenta palabras, no pares.
 *
 * branch_code en esa tabla queda como PROCEDENCIA, no como pertenencia:
 * dice de qué branch se tomó el tag, y no obliga al perfil a tener ese
 * branch elegido. Es lo coherente con §2.4, donde los tags son
 * transversales. Quien escriba la query de agrupación por branch tiene
 * que saberlo: agrupar perfiles por el branch de sus tags NO es lo
 * mismo que agrupar por sus branches.
 *
 * EL SEED VA APARTE, en /api/seed-genres. Esta ruta solo crea la forma.
 * Separarlos es a propósito: la forma se puede correr en main hoy, y los
 * datos todavía no existen porque falta el .docx de la taxonomía.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLAS = [
  "genre_branches",
  "genre_tags",
  "genre_aliases",
  "cross_tags",
  "artist_genres",
  "artist_genre_tags",
  "artist_cross_tags",
  "collective_genres",
  "collective_genre_tags",
  "collective_cross_tags",
];

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
   * El estado verificable de la migración.
   *
   * Cuenta filas, pero sobre todo describe la FORMA: columnas,
   * constraints e índices por tabla. Para una migración cuyo único
   * producto es la forma, "la tabla existe" no prueba nada: CREATE TABLE
   * IF NOT EXISTS frente a una tabla preexistente con otras columnas
   * salta en silencio, y CREATE INDEX IF NOT EXISTS compara el nombre
   * del índice y no su definición. Sin esto, el log afirmaría que la
   * regla del primario único está puesta cuando podría no estarlo.
   */
  const estado = async () => {
    const existentes = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${TABLAS}::text[])
    `;
    const nombres = existentes.map((r) => r.table_name as string).sort();

    const filas: Record<string, number> = {};
    const forma: Record<string, { columnas: number; constraints: string[]; indices: string[] }> = {};

    for (const t of nombres) {
      // El nombre de tabla se interpola, pero sale de TABLAS, que es una
      // constante de este archivo. Nunca llega nada del request acá.
      const cuenta = await sql(`SELECT COUNT(*)::int AS n FROM ${t}`);
      filas[t] = cuenta[0].n as number;

      const cols = await sql`
        SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${t}
      `;
      const cons = await sql`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = ${t}
        ORDER BY constraint_name
      `;
      const idx = await sql`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ${t}
        ORDER BY indexname
      `;
      forma[t] = {
        columnas: cols[0].n as number,
        // Los nombres autogenerados de FK y NOT NULL sobran para
        // comparar, pero los de PK, únicos y CHECK son justamente lo que
        // hay que poder mirar de una corrida a la otra.
        constraints: cons.map((r) => r.constraint_name as string),
        indices: idx.map((r) => r.indexname as string),
      };
    }
    return { tablas: nombres, filas, forma };
  };

  try {
    const antes = await estado();

    if (dryRun) {
      const faltan = TABLAS.filter((t) => !antes.tablas.includes(t));
      log.push(
        faltan.length === 0
          ? `SIMULACIÓN: las ${TABLAS.length} tablas ya existen, no habría cambios`
          : `SIMULACIÓN: se crearían ${faltan.length} tablas`
      );
      log.push("SIMULACIÓN: no se modifica ni se borra ninguna fila existente");
      if (faltan.length > 0 && faltan.length < TABLAS.length) {
        log.push(
          "OJO: hay tablas preexistentes. Compará 'forma' antes de seguir: una tabla con el nombre correcto puede tener otras columnas."
        );
      }
      return NextResponse.json({ ok: true, dryRun, log, estado: antes, seCrearian: faltan });
    }

    // --- vocabulario ------------------------------------------------
    // Los FK y CHECK van inline dentro del CREATE, donde ya son
    // idempotentes solos: no hacen falta los DO $$ ... EXCEPTION que sí
    // necesitan los ALTER TABLE.
    await sql`
      CREATE TABLE IF NOT EXISTS genre_branches (
        code        TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
        name        TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    log.push("genre_branches lista");

    await sql`
      CREATE TABLE IF NOT EXISTS genre_tags (
        slug        TEXT NOT NULL,
        branch_code TEXT NOT NULL REFERENCES genre_branches(code) ON UPDATE CASCADE ON DELETE CASCADE,
        name        TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (slug, branch_code)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS genre_tags_branch_idx ON genre_tags (branch_code)`;
    await sql`CREATE INDEX IF NOT EXISTS genre_tags_slug_idx ON genre_tags (slug)`;
    log.push("genre_tags lista (PK compuesta: un tag puede vivir en varios branches)");

    await sql`
      CREATE TABLE IF NOT EXISTS genre_aliases (
        alias       TEXT PRIMARY KEY,
        branch_code TEXT NOT NULL REFERENCES genre_branches(code) ON UPDATE CASCADE ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    // lower(alias) único: se busca "dnb", "DnB" y "DNB" y es el mismo.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS genre_aliases_lower_idx ON genre_aliases (lower(alias))`;
    log.push("genre_aliases lista");

    await sql`
      CREATE TABLE IF NOT EXISTS cross_tags (
        slug       TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('dj_type','era','contexto','formato','energia')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    log.push("cross_tags lista");

    // --- vínculos de artista ----------------------------------------
    // RESTRICT hacia el vocabulario: ver la nota de borrado arriba.
    await sql`
      CREATE TABLE IF NOT EXISTS artist_genres (
        artist_slug TEXT NOT NULL REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        branch_code TEXT NOT NULL REFERENCES genre_branches(code) ON UPDATE CASCADE ON DELETE RESTRICT,
        is_primary  BOOLEAN NOT NULL DEFAULT false,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (artist_slug, branch_code)
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS artist_genres_one_primary_idx
      ON artist_genres (artist_slug) WHERE is_primary
    `;
    // Índice inverso: la pieza 3 filtra "quiénes tocan TEC", que sin esto
    // escanea la tabla entera. También es el lado hijo del FK.
    await sql`CREATE INDEX IF NOT EXISTS artist_genres_branch_idx ON artist_genres (branch_code)`;
    log.push("artist_genres lista (índice único parcial: un solo branch primario)");

    await sql`
      CREATE TABLE IF NOT EXISTS artist_genre_tags (
        artist_slug TEXT NOT NULL REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        tag_slug    TEXT NOT NULL,
        branch_code TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (artist_slug, tag_slug, branch_code),
        FOREIGN KEY (tag_slug, branch_code)
          REFERENCES genre_tags (slug, branch_code) ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `;
    // Un tag, una vez por perfil. Ver la nota arriba.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS artist_genre_tags_one_per_tag_idx
      ON artist_genre_tags (artist_slug, tag_slug)
    `;
    await sql`CREATE INDEX IF NOT EXISTS artist_genre_tags_tag_idx ON artist_genre_tags (tag_slug)`;
    log.push("artist_genre_tags lista (un tag una sola vez por perfil)");

    await sql`
      CREATE TABLE IF NOT EXISTS artist_cross_tags (
        artist_slug TEXT NOT NULL REFERENCES artists(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        tag_slug    TEXT NOT NULL REFERENCES cross_tags(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (artist_slug, tag_slug)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS artist_cross_tags_tag_idx ON artist_cross_tags (tag_slug)`;
    log.push("artist_cross_tags lista");

    // --- vínculos de colectivo --------------------------------------
    await sql`
      CREATE TABLE IF NOT EXISTS collective_genres (
        collective_slug TEXT NOT NULL REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        branch_code     TEXT NOT NULL REFERENCES genre_branches(code) ON UPDATE CASCADE ON DELETE RESTRICT,
        is_primary      BOOLEAN NOT NULL DEFAULT false,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (collective_slug, branch_code)
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS collective_genres_one_primary_idx
      ON collective_genres (collective_slug) WHERE is_primary
    `;
    await sql`CREATE INDEX IF NOT EXISTS collective_genres_branch_idx ON collective_genres (branch_code)`;
    log.push("collective_genres lista (índice único parcial: un solo branch primario)");

    await sql`
      CREATE TABLE IF NOT EXISTS collective_genre_tags (
        collective_slug TEXT NOT NULL REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        tag_slug        TEXT NOT NULL,
        branch_code     TEXT NOT NULL,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (collective_slug, tag_slug, branch_code),
        FOREIGN KEY (tag_slug, branch_code)
          REFERENCES genre_tags (slug, branch_code) ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS collective_genre_tags_one_per_tag_idx
      ON collective_genre_tags (collective_slug, tag_slug)
    `;
    await sql`CREATE INDEX IF NOT EXISTS collective_genre_tags_tag_idx ON collective_genre_tags (tag_slug)`;
    log.push("collective_genre_tags lista (un tag una sola vez por perfil)");

    await sql`
      CREATE TABLE IF NOT EXISTS collective_cross_tags (
        collective_slug TEXT NOT NULL REFERENCES collectives(slug) ON UPDATE CASCADE ON DELETE CASCADE,
        tag_slug        TEXT NOT NULL REFERENCES cross_tags(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (collective_slug, tag_slug)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS collective_cross_tags_tag_idx ON collective_cross_tags (tag_slug)`;
    log.push("collective_cross_tags lista");

    // La verificación va en su propio try. Si se cae acá, la migración ya
    // terminó: reportarla como fallida mandaría a alguien a investigar un
    // problema que no existe, y este JSON es el único canal que hay.
    try {
      const despues = await estado();
      log.push(`${despues.tablas.length} de ${TABLAS.length} tablas presentes al terminar`);
      return NextResponse.json({ ok: true, dryRun, log, estado: despues });
    } catch (err) {
      log.push("la migración terminó, pero la verificación posterior falló");
      return NextResponse.json({
        ok: true,
        dryRun,
        log,
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
