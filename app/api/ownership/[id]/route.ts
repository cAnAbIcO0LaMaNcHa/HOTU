/**
 * PATCH /api/ownership/[id] — el receptor responde una cesión.
 *
 * Body: { action: "accept" | "decline" }
 *
 * Solo el destinatario. Ni quien la ofreció ni un moderador: es la única
 * decisión de esta pieza que no es del dueño, y ese es exactamente el
 * punto — las obligaciones de administrar algo no se le encajan a nadie
 * sin que acepte.
 *
 * Rechazar deja el colectivo desamparado. NO se lo devuelve a quien lo
 * cedió: ya lo cedió, y esa decisión fue real.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { responderCesion } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "No encontré esa cesión" }, { status: 404 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const action = body?.action;
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json(
      { error: "action tiene que ser 'accept' o 'decline'" },
      { status: 400 }
    );
  }

  const r = await responderCesion(id, action, email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // Aceptar cambia quién administra el colectivo; rechazar lo deja sin
  // dueño. Las dos cambian quién ve qué panel.
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, ...r.value });
}
