/**
 * DELETE /api/artists/[slug]/photos/[photoId] — borra una foto.
 *
 * El PATCH que había acá se fue: reordenaba UNA foto, y mover una cambia la posición de
 * varias. El orden se manda entero, con PUT a la colección.
 *
 * El id va en la ruta Y el slug también, y el write path los usa LOS DOS en el WHERE. No es
 * redundante: sin el slug, el dueño de un perfil podría borrar la foto de otro mandando un
 * id ajeno, porque la autorización dice que puede editar ESTE perfil y no cualquiera.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { borrarFoto } from "@/lib/epk-galeria-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; photoId: string }> }
) {
  const { slug, photoId } = await params;
  /** Un id que no es un entero es un 404 y no un 500: la ruta existe, esa foto no. */
  const id = Number(photoId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await borrarFoto(slug, id, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
