/**
 * POST /api/news — publicar una noticia desde el panel (tanda 5 §3).
 *
 * Body: { authorCollectiveSlug, title, excerpt, tag, date?, enviar? }
 *
 * Nace SIN PUBLICAR y entra en la cola de aprobación. Quién puede y qué
 * transiciones valen están en lib/news-write.ts, que es lo que va a
 * llamar también la app.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createCommunityNews } from "@/lib/news-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await createCommunityNews(body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  /**
   * NO hay revalidatePath acá, y es la diferencia con /api/events.
   *
   * La noticia nace con status 'draft', así que no cambió nada de lo que
   * ve un visitante: ninguna página cacheada quedó vieja. Lo que la hace
   * pública es la aprobación, y ahí sí se revalida. Tirar el caché del
   * layout entero por una fila que nadie puede ver todavía es puro costo.
   */
  return NextResponse.json({ ok: true, ...result.value }, { status: 201 });
}
