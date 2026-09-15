/**
 * PATCH /api/artists/[slug]/review — el DJ mueve su perfil en la cola.
 *
 * Body: { action: "submit" | "withdraw" }
 *
 * Solo el DJ sobre su propio perfil. Aprobar y rechazar NO están acá: son
 * del admin y viven en su propia ruta, porque quien puede hacerlas y por
 * qué son preguntas distintas.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { submitForReview, withdrawFromReview } from "@/lib/artists-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { slug } = await params;
  const action = body?.action;

  if (action !== "submit" && action !== "withdraw") {
    return NextResponse.json(
      { error: "action tiene que ser 'submit' o 'withdraw'" },
      { status: 400 }
    );
  }

  const result =
    action === "submit"
      ? await submitForReview(slug, email)
      : await withdrawFromReview(slug, email);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}
