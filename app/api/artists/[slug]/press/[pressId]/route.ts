/**
 * DELETE /api/artists/[slug]/press/[pressId] — borra una nota de prensa.
 *
 * El slug va en el WHERE además del id, por lo mismo que en las fotos: la autorización
 * dice que puede editar ESTE perfil, no cualquiera.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { borrarNota } from "@/lib/epk-galeria-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; pressId: string }> }
) {
  const { slug, pressId } = await params;
  const n = Number(pressId);
  if (!Number.isInteger(n) || n <= 0) {
    return NextResponse.json({ error: "Press item not found" }, { status: 404 });
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await borrarNota(slug, n, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
