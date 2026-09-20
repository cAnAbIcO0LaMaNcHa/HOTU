/**
 * PATCH /api/news/[id]/review — el autor mueve su noticia en la cola.
 *
 * Body: { action: "submit" | "withdraw" }
 *
 * Aprobar y rechazar NO están acá: son del moderador y viven en
 * /api/admin/news/[id], igual que con los perfiles de DJ. Quién puede
 * hacerlas y qué significan son preguntas distintas.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { submitNewsForReview, withdrawNewsFromReview } from "@/lib/news-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const raw = Number((await params).id);
  if (!Number.isInteger(raw) || raw <= 0) {
    return NextResponse.json({ error: "Noticia no encontrada" }, { status: 404 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const action = body?.action;
  if (action !== "submit" && action !== "withdraw") {
    return NextResponse.json(
      { error: "action tiene que ser 'submit' o 'withdraw'" },
      { status: 400 }
    );
  }

  const result =
    action === "submit"
      ? await submitNewsForReview(raw, email)
      : await withdrawNewsFromReview(raw, email);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}
