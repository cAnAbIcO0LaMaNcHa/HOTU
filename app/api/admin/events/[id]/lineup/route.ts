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
import { auth } from "@/auth";
import { isModerator } from "@/lib/roles-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  /**
   * isModerator Y NO requireAdmin, Y ES UN ARREGLO, NO UN CAMBIO DE ESTILO.
   *
   * En este repo conviven dos sistemas de admin que NO son el mismo conjunto:
   *
   *   requireAdmin()  ->  isAdminEmail: la lista de ADMIN_EMAILS del entorno.
   *   isModerator()   ->  esa lista O el rol SUPER_ADMIN/MODERATOR en user_roles.
   *
   * app/admin/layout.tsx usa isModerator, así que un MODERATOR por rol ABRÍA
   * /admin/lineups y NO PODÍA GUARDAR: enganchaba los nombres, apretaba, y se
   * comía un 403 sin explicación. Un control que la pantalla ofrece y el server
   * niega es peor que un control ausente.
   *
   * Enganchar un lineup es moderación —decide de quién es un toque y a quién le
   * cuenta de convocatoria— así que la puerta correcta es la del panel.
   *
   * Se descubrió construyendo /admin/organizadores, que había copiado este mismo
   * patrón y fallaba igual con un MODERATOR de rol.
   */
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isModerator(actorEmail))) {
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
   * ============================================================
   * LAS FILAS QUE VIENEN DE UNA POSTULACIÓN ACEPTADA NO SE BORRAN ACÁ
   * ============================================================
   *
   * Un DJ que entró al lineup porque el dueño le aceptó la postulación no es lo mismo que un
   * nombre que el importador sacó del flyer: hay un acuerdo entre dos partes, y el DJ ya
   * tiene la fecha anunciada. Sacarlo tiene su propia acción —CANCELAR PARTICIPACIÓN, con
   * motivo obligatorio, que además le avisa— y no puede pasar como efecto colateral de
   * guardar el editor.
   *
   * SE DERIVA, NO SE MARCA. No hay ninguna columna nueva en event_lineup que diga 'esta vino
   * de una postulación': se pregunta por event_applications. Una bandera habría que
   * mantenerla sincronizada con la postulación, y el día que se desincronice el editor
   * borraría una fila protegida sin que nada chille.
   *
   * LA PROTECCIÓN TIENE DOS MITADES, y las dos hacen falta:
   *
   *   1. SI LA LISTA OMITE UNA, SE NIEGA con 409 y se nombra a quién. Guardar sin ese DJ es
   *      lo que el admin quiso decir, así que hay que contestarle, no arreglárselo por
   *      debajo.
   *   2. LAS QUE SIGUEN EN LA LISTA NO ENTRAN AL DELETE. Se les actualiza la posición y el
   *      texto en vez de borrarlas y reinsertarlas, así la fila —su id y su created_at—
   *      sobrevive al guardado. Sin esto la regla se cumpliría de palabra y no de hecho: la
   *      fila se iría y volvería con otra identidad.
   */
  const aceptadas = await sql`
    SELECT DISTINCT el.id, el.artist_slug
    FROM event_lineup el
    JOIN event_applications ea ON ea.artist_slug = el.artist_slug
    JOIN event_calls ec ON ec.id = ea.call_id
    WHERE el.event_id = ${eventId}
      AND ec.event_id = ${eventId}
      AND ea.resultado = 'aceptada'
  `;
  const protegidas = new Map(
    aceptadas.map((f) => [f.artist_slug as string, f.id as number])
  );

  if (protegidas.size > 0) {
    const enLaLista = new Set(limpias.map((e) => e.artistSlug).filter(Boolean) as string[]);
    const omitidas = [...protegidas.keys()].filter((slug) => !enLaLista.has(slug));
    if (omitidas.length > 0) {
      return NextResponse.json(
        {
          error:
            `No puedo sacar del lineup a ${omitidas.join(", ")}: entraron porque les ` +
            "aceptaste la postulación, y ya tienen la fecha anunciada. Para sacarlos hay que " +
            "CANCELAR LA PARTICIPACIÓN desde las postulaciones del evento, que pide un motivo " +
            "y se lo avisa al DJ. Volvé a poner esos nombres en la lista y guardá.",
          omitidas,
        },
        { status: 409 }
      );
    }
  }

  /**
   * Borrar y reinsertar lo NO protegido, en UNA transacción.
   *
   * Reinsertar en vez de actualizar fila por fila porque las entradas se identifican por
   * posición y no tienen un id estable del lado del cliente. Eso sigue siendo cierto y sigue
   * siendo deuda —resetea created_at de todo lo que no está protegido— pero arreglarlo es
   * pasar el editor a actualizar por id, que es su propia pieza.
   *
   * Y en una sola transacción porque cada sql del driver HTTP es su propio request: borrar y
   * que falle el insert dejaría el evento sin lineup, que es peor que dejarlo mal resuelto.
   */
  const revisadoEn = body.marcarRevisado === true ? new Date().toISOString() : null;
  const idsProtegidos = [...protegidas.values()];

  await sql.transaction([
    sql`
      DELETE FROM event_lineup
      WHERE event_id = ${eventId} AND NOT (id = ANY(${idsProtegidos}::int[]))
    `,
    ...limpias.map((e, i) =>
      e.artistSlug && protegidas.has(e.artistSlug)
        ? sql`
            UPDATE event_lineup SET position = ${i}, raw_name = ${e.rawName}
            WHERE id = ${protegidas.get(e.artistSlug)}
          `
        : sql`
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
