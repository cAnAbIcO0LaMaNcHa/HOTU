/**
 * POST   /api/likes/collectives/[slug] — seguir este colectivo o venue
 * DELETE /api/likes/collectives/[slug] — dejar de seguirlo
 *
 * Espejo exacto de /api/likes/artists/[slug], y una sola ruta para las
 * dos entidades: comparten tabla y un like es un like. Poner
 * /api/likes/venues/[slug] aparte sería duplicar el archivo entero para
 * cambiar una palabra.
 *
 * El like siempre es del email de la sesión de quien llama. No hay body
 * ni parámetro de usuario, justamente para que una cuenta no pueda
 * seguir ni dejar de seguir en nombre de otra.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { likeCollective, unlikeCollective } from "@/lib/likes-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { slug } = await params;
  const result = await likeCollective(slug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { slug } = await params;
  const result = await unlikeCollective(slug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}
