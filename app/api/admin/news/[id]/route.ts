/**
 * PATCH /api/admin/news/[id] — aprobar o rechazar una noticia.
 *
 * Body: { action: "approve" } | { action: "reject", note: "..." }
 *
 * Espejo exacto de /api/admin/artists/[slug]: el permiso lo resuelve
 * lib/news-write con isSuperAdmin, el mismo que usa el layout de /admin.
 * Una sola regla, un solo lugar.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { approveNews, rejectNews } from "@/lib/news-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Noticia no encontrada" }, { status: 404 });
  }

  let body: { action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (body?.action === "approve") {
    const r = await approveNews(id, email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    // Aprobar ES publicar: recién acá cambia lo que ve un visitante, así
    // que recién acá hay caché viejo que tirar.
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, ...r.value });
  }

  if (body?.action === "reject") {
    const r = await rejectNews(id, body.note, email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, ...r.value });
  }

  return NextResponse.json(
    { error: "action tiene que ser 'approve' o 'reject'" },
    { status: 400 }
  );
}
