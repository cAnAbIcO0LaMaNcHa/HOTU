/**
 * GET /api/artists/[slug]/residency-offers — lo que este DJ tiene para responder.
 *
 * Solo el dueño del perfil de artista. No es una lista pública: decir en qué
 * colectivos le ofrecieron la residencia a alguien es contar una conversación
 * que todavía no terminó, y una oferta sin responder puede ser un "no" que no
 * se dijo todavía.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { ofertasAbiertasDeArtista } from "@/lib/residency-offers-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const rows = await sql`SELECT owner_email FROM artists WHERE slug = ${slug}`;
  if (rows.length === 0) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const owner = rows[0].owner_email as string | null;
  if (!owner || owner.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "No es tuyo" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, ofertas: await ofertasAbiertasDeArtista(slug) });
}
