/**
 * PATCH  /api/news/[id] — el autor corrige su noticia.
 * DELETE /api/news/[id] — el autor la descarta.
 *
 * Los dos solo mientras no esté publicada. Mover la noticia dentro de la
 * cola —mandarla, retirarla— vive en /api/news/[id]/review, aparte por
 * lo mismo que en el perfil de DJ: editar el contenido y cambiar su
 * estado son operaciones distintas, y mezclarlas obliga a ramificar
 * permisos por acción dentro de un mismo endpoint.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteCommunityNews, updateCommunityNews } from "@/lib/news-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** El id de la URL, o null si no es un entero. */
function leerId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = leerId((await params).id);
  if (id === null) return NextResponse.json({ error: "Noticia no encontrada" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await updateCommunityNews(id, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = leerId((await params).id);
  if (id === null) return NextResponse.json({ error: "Noticia no encontrada" }, { status: 404 });

  const result = await deleteCommunityNews(id, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}
