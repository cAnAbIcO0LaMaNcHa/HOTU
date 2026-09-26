/**
 * PATCH /api/claims/[id] — aprobar o rechazar un reclamo.
 *
 * Body: { accion: "aprobar" | "rechazar", motivo }
 *
 * Un rechazo SIN motivo no pasa: lo frena el lib y lo frena la base con un
 * CHECK. Es lo único que la persona del otro lado recibe.
 *
 * El id va en la URL y no en el body porque acá sí es un identificador de
 * recurso: un número de reclamo, no el correo de nadie.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { responderReclamo } from "@/lib/claims-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const actor = session?.user?.email;
  if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { accion?: unknown; motivo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { id } = await params;
  const r = await responderReclamo(id, body.accion, body.motivo, actor);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // Aprobar cambia quién puede editar el perfil, y las dos respuestas
  // cambian la cola del admin y la bandeja del reclamante.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...r.value });
}
