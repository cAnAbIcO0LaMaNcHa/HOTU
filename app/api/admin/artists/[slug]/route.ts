/**
 * PATCH /api/admin/artists/[slug] — aprobar o rechazar un perfil.
 *
 * Body: { action: "approve" } | { action: "reject", note: "..." }
 *
 * Aparte de la ruta del DJ (/api/artists/[slug]/review) a propósito:
 * quién puede hacerlo y qué significa son preguntas distintas, y
 * mezclarlas en un endpoint obliga a ramificar permisos por acción.
 *
 * El permiso lo resuelve lib/artists-write con isSuperAdmin, el mismo que
 * usa el layout de /admin. Una sola regla, un solo lugar.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveArtist, rejectArtist } from "@/lib/artists-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { slug } = await params;

  if (body?.action === "approve") {
    const r = await approveArtist(slug, email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, ...r.value });
  }

  if (body?.action === "reject") {
    const r = await rejectArtist(slug, body.note, email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, ...r.value });
  }

  return NextResponse.json(
    { error: "action tiene que ser 'approve' o 'reject'" },
    { status: 400 }
  );
}
