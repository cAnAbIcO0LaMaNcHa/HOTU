/**
 * SEED — TANDA 4, PIEZA 1: el vocabulario de géneros.
 *
 * Protegido con MIGRATE_SECRET:
 *   /api/seed-genres?secret=YOUR_SECRET&dryRun=1
 *   /api/seed-genres?secret=YOUR_SECRET
 *
 * Separado de /api/setup-genres a propósito. La migración crea la forma
 * y se puede correr en main hoy; el vocabulario todavía no existe porque
 * falta HOTU_DJ_Genre_Classification_2026.docx. Con las dos cosas en una
 * ruta habría que elegir entre no crear las tablas o sembrarlas a medias.
 *
 * Lee todo de lib/genre-taxonomy.ts. Hoy ese archivo tiene BRANCHES y
 * TAGS vacíos, así que esta ruta siembra los 50 cross-tags —que sí están
 * completos en HOTFIX.md §2.5— y reporta los otros como pendientes.
 * Cuando aparezca el .docx, llenar ese archivo es el único trabajo: esta
 * ruta no cambia.
 *
 * ES UN SEED DE VOCABULARIO, NO DE PERFILES. No le asigna género a
 * ningún artista ni colectivo. Los 12 artistas y 6 colectivos que ya
 * existen quedan sin género a propósito (pieza 2): inventarles uno sería
 * afirmar algo que nadie declaró.
 *
 * IDEMPOTENTE POR UPSERT, no por "insertar si no hay nada". Cada fila se
 * escribe con ON CONFLICT DO UPDATE sobre los campos editoriales, así
 * que corregir un nombre en el archivo y volver a correrlo actualiza en
 * vez de duplicar. Lo que NUNCA borra es filas que ya no estén en el
 * archivo: un DELETE acá se llevaría en cascada los géneros que los
 * usuarios ya eligieron. Las bajas de vocabulario son a mano, y el FK
 * RESTRICT de la migración obliga a mirarlas una por una.
 *
 * OJO CON LOS RENOMBRES, que ya mordió una vez. El conflicto se resuelve
 * por SLUG, y el slug sale del nombre. Cambiar "Radio" por "Radio /
 * Broadcast" no actualiza la fila: inserta una nueva con otro slug y deja
 * la vieja ahí, y el conteo sube en vez de quedarse igual. Pasó en dev
 * con tres cross-tags cuyos nombres yo había adivinado antes de tener el
 * documento, y se vio solo porque el total dio 53 donde tenía que dar 50.
 *
 * Por eso el conteo de antes y después vale la pena mirarlo: si sube
 * cuando esperabas que quedara igual, hubo un renombre y quedó un
 * huérfano. Limpiarlo es a mano y solo es seguro si ningún perfil lo usa,
 * cosa que el FK RESTRICT garantiza que se note.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { ALIASES, BRANCHES, CROSS_TAGS, TAGS } from "@/lib/genre-taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  const contar = async () => {
    const [r] = await sql`
      SELECT (SELECT COUNT(*)::int FROM genre_branches) AS branches,
             (SELECT COUNT(*)::int FROM genre_tags)     AS tags,
             (SELECT COUNT(*)::int FROM genre_aliases)  AS aliases,
             (SELECT COUNT(*)::int FROM cross_tags)     AS cross_tags
    `;
    return r as Record<string, number>;
  };

  try {
    // Si la migración no corrió, decirlo claro en vez de reventar con un
    // "relation does not exist" que no le dice nada a nadie.
    const existe = await sql`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'genre_branches'
    `;
    if (existe[0].n === 0) {
      return NextResponse.json(
        { ok: false, error: "Falta correr /api/setup-genres primero: no existe genre_branches" },
        { status: 409 }
      );
    }

    const antes = await contar();

    // Los alias apuntan a un branch por FK. Mientras BRANCHES esté vacío
    // no hay a dónde apuntar, así que se saltean en vez de fallar.
    const codigos = new Set(BRANCHES.map((b) => b.code));
    const aliasSembrables = ALIASES.filter((a) => codigos.has(a.branchCode));
    const aliasSalteados = ALIASES.length - aliasSembrables.length;

    if (BRANCHES.length === 0) {
      log.push(
        "PENDIENTE: BRANCHES está vacío en lib/genre-taxonomy.ts. Falta HOTU_DJ_Genre_Classification_2026.docx, que no está en el repo."
      );
    }
    if (TAGS.length === 0) {
      log.push("PENDIENTE: TAGS está vacío por la misma razón.");
    }
    if (aliasSalteados > 0) {
      log.push(
        `${aliasSalteados} alias salteados: su branch todavía no existe. Vuelven solos cuando se siembren los branches.`
      );
    }

    if (dryRun) {
      log.push(
        `SIMULACIÓN: se escribirían ${BRANCHES.length} branches, ${TAGS.length} tags, ${aliasSembrables.length} alias y ${CROSS_TAGS.length} cross-tags`
      );
      log.push("SIMULACIÓN: no se borra ninguna fila, ni de vocabulario ni de perfil");
      return NextResponse.json({ ok: true, dryRun, log, antes });
    }

    // --- branches ---------------------------------------------------
    for (const b of BRANCHES) {
      await sql`
        INSERT INTO genre_branches (code, name, category, sort_order)
        VALUES (${b.code}, ${b.name}, ${b.category}, ${b.sortOrder})
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          sort_order = EXCLUDED.sort_order
      `;
    }
    log.push(`${BRANCHES.length} branches escritos`);

    // --- tags -------------------------------------------------------
    for (const t of TAGS) {
      await sql`
        INSERT INTO genre_tags (slug, branch_code, name, sort_order)
        VALUES (${t.slug}, ${t.branchCode}, ${t.name}, ${t.sortOrder})
        ON CONFLICT (slug, branch_code) DO UPDATE SET
          name = EXCLUDED.name,
          sort_order = EXCLUDED.sort_order
      `;
    }
    log.push(`${TAGS.length} tags escritos`);

    // --- alias ------------------------------------------------------
    // ON CONFLICT (alias) no cubre el índice único sobre lower(alias):
    // sembrar "DNB" existiendo "DnB" reventaría. Por eso se busca antes
    // por lower() y se actualiza esa fila, sea como esté escrita.
    for (const a of aliasSembrables) {
      const ya = await sql`SELECT alias FROM genre_aliases WHERE lower(alias) = lower(${a.alias})`;
      if (ya.length > 0) {
        await sql`UPDATE genre_aliases SET branch_code = ${a.branchCode} WHERE alias = ${ya[0].alias}`;
      } else {
        await sql`INSERT INTO genre_aliases (alias, branch_code) VALUES (${a.alias}, ${a.branchCode})`;
      }
    }
    log.push(`${aliasSembrables.length} alias escritos`);

    // --- cross-tags -------------------------------------------------
    for (const c of CROSS_TAGS) {
      await sql`
        INSERT INTO cross_tags (slug, name, kind, sort_order)
        VALUES (${c.slug}, ${c.name}, ${c.kind}, ${c.sortOrder})
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          kind = EXCLUDED.kind,
          sort_order = EXCLUDED.sort_order
      `;
    }
    log.push(`${CROSS_TAGS.length} cross-tags escritos`);

    const despues = await contar();
    return NextResponse.json({
      ok: true,
      dryRun,
      log,
      antes,
      despues,
      faltaElDocumento: BRANCHES.length === 0 || TAGS.length === 0,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, dryRun, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
