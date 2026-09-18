/**
 * PATCH /api/collaborations/[id] — aceptar o rechazar una invitación a
 * colaborar en un set o un track (§6.1).
 *
 * Body: { action: "accept" | "decline" }.
 *
 * La invitación siempre se responde desde la cuenta del invitado: el
 * permiso sale de la sesión y no del body, así que nadie puede aceptar
 * en nombre de otro. Una invitación que no es tuya devuelve 404 y no
 * 403, para que probar ids no deje enumerar las ajenas.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { aceptarColaboracion, rechazarColaboracion } from "@/lib/collaborators-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (body.action === "accept") {
    const r = await aceptarColaboracion(n, email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, ...r.value });
  }
  if (body.action === "decline") {
    const r = await rechazarColaboracion(n, email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, ...r.value });
  }
  return NextResponse.json({ error: "action tiene que ser 'accept' o 'decline'" }, { status: 400 });
}
