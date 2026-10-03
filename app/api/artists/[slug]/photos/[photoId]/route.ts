/**
 * PATCH  /api/artists/[slug]/photos/[photoId] — reordena.
 * DELETE /api/artists/[slug]/photos/[photoId] — borra.
 *
 * El id va en la ruta Y el slug también, y el write path los usa LOS DOS en el WHERE.
 * No es redundante: sin el slug, el dueño de un perfil podría borrar la foto de otro
 * mandando un id ajeno, porque la autorización dice que puede editar ESTE perfil y no
 * cualquiera.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { borrarFoto, reordenarFoto } from "@/lib/epk-galeria-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; photoId: string }> };

/** Un id que no es un entero es un 404 y no un 500: la ruta existe, esa foto no. */
function idDe(crudo: string): number | null {
  const n = Number(crudo);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { slug, photoId } = await params;
  const id = idDe(photoId);
  if (id === null) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

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

  const result = await reordenarFoto(slug, id, (body as { sortOrder?: unknown }).sortOrder, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, id: result.value.id });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { slug, photoId } = await params;
  const id = idDe(photoId);
  if (id === null) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await borrarFoto(slug, id, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
