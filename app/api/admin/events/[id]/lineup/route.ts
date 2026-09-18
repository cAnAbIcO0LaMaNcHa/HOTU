/**
 * PATCH /api/admin/events/[id]/lineup — resolver a mano el lineup de un
 * evento (§7).
 *
 * Solo admin. Body: { entries: [{ rawName, artistSlug, collectiveSlug }],
 * marcarRevisado?: boolean }.
 *
 * SE REESCRIBEN LAS RESOLUCIONES, NO LOS NOMBRES. raw_name es el texto
 * del flyer y no se toca desde acá: lo único que cambia es a quién
 * apunta cada entrada. Cambiar el texto se hace editando events.lineup y
 * volviendo a importar, que es el camino donde el cambio queda
 * registrado en la columna congelada.
 *
 * UN VENUE NO TOCA EN UN LINEUP. La misma regla que el import, y hay que
 * repetirla acá porque este es otro camino de escritura: la app móvil va
 * a usar el mismo endpoint, y que la UI no ofrezca venues en el
 * desplegable no es lo mismo que que el endpoint los rechace.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: { entries?: unknown; marcarRevisado?: unknown };
  try {
    body = (await request.json()) as { entries?: unknown; marcarRevisado?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.entries)) {
    return NextResponse.json({ error: "entries tiene que ser una lista" }, { status: 400 });
  }

  const entradas = body.entries as Array<{
    rawName?: unknown;
    artistSlug?: unknown;
    collectiveSlug?: unknown;
  }>;

  const limpias: Array<{ rawName: string; artistSlug: string | null; collectiveSlug: string | null }> =
    [];
  for (const e of entradas) {
    const rawName = typeof e?.rawName === "string" ? e.rawName.trim() : "";
    if (!rawName) {
      return NextResponse.json({ error: "Cada entrada necesita su rawName" }, { status: 400 });
    }
    const a = typeof e?.artistSlug === "string" && e.artistSlug ? e.artistSlug : null;
    const c = typeof e?.collectiveSlug === "string" && e.collectiveSlug ? e.collectiveSlug : null;
    if (a && c) {
      return NextResponse.json(
        { error: "Una entrada es un artista O un colectivo, no los dos" },
        { status: 400 }
      );
    }
    limpias.push({ rawName, artistSlug: a, collectiveSlug: c });
  }

  // Que existan, y que ningún colectivo sea un venue.
  const colectivos = limpias.map((e) => e.collectiveSlug).filter(Boolean) as string[];
  if (colectivos.length > 0) {
    const filas = await sql`
      SELECT slug, entity_kind FROM collectives WHERE slug = ANY(${colectivos}::text[])
    `;
    const porSlug = new Map(filas.map((r) => [r.slug as string, r.entity_kind as string]));
    const faltan = colectivos.filter((s) => !porSlug.has(s));
    if (faltan.length > 0) {
      return NextResponse.json(
        { error: `No existen estos colectivos: ${faltan.join(", ")}` },
        { status: 400 }
      );
    }
    const venues = colectivos.filter((s) => porSlug.get(s) === "venue");
    if (venues.length > 0) {
      return NextResponse.json(
        {
          error: `Un venue no toca en un lineup: la música es de quien la hace, no del lugar donde suena (${venues.join(", ")})`,
        },
        { status: 400 }
      );
    }
  }

  const artistas = limpias.map((e) => e.artistSlug).filter(Boolean) as string[];
  if (artistas.length > 0) {
    const filas = await sql`SELECT slug FROM artists WHERE slug = ANY(${artistas}::text[])`;
    const hay = new Set(filas.map((r) => r.slug as string));
    const faltan = artistas.filter((s) => !hay.has(s));
    if (faltan.length > 0) {
      return NextResponse.json(
        { error: `No existen estos artistas: ${faltan.join(", ")}` },
        { status: 400 }
      );
    }
  }

  /**
   * Borrar y reinsertar, en UNA transacción.
   *
   * Reinsertar en vez de actualizar fila por fila porque las entradas se
   * identifican por posición y no tienen un id estable del lado del
   * cliente. Y en una sola transacción porque cada sql del driver HTTP es
   * su propio request: borrar y que falle el insert dejaría el evento sin
   * lineup, que es peor que dejarlo mal resuelto.
   */
  const revisadoEn = body.marcarRevisado === true ? new Date().toISOString() : null;

  await sql.transaction([
    sql`DELETE FROM event_lineup WHERE event_id = ${eventId}`,
    ...limpias.map((e, i) =>
      sql`
        INSERT INTO event_lineup (event_id, raw_name, artist_slug, collective_slug, position)
        VALUES (${eventId}, ${e.rawName}, ${e.artistSlug}, ${e.collectiveSlug}, ${i})
      `
    ),
    // Un ISO y no el literal "now()": interpolado en un tagged template
    // eso viaja como PARÁMETRO, o sea como la cadena de seis letras
    // "now()", y el cast a timestamptz la rechaza. La hora del servidor
    // de Node sirve igual para marcar cuándo se revisó.
    sql`
      UPDATE events SET lineup_reviewed_at = ${revisadoEn}::timestamptz
      WHERE id = ${eventId}
    `,
  ]);

  const [sinResolver] = await sql`
    SELECT COUNT(*)::int AS n FROM event_lineup
    WHERE event_id = ${eventId} AND artist_slug IS NULL AND collective_slug IS NULL
  `;

  return NextResponse.json({
    ok: true,
    entradas: limpias.length,
    sinResolver: sinResolver.n as number,
  });
}
