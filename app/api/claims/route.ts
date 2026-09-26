/**
 * POST /api/claims — reclamar un perfil desamparado o de dueño fantasma.
 *
 * Body: { tipo: "artist" | "collective", slug, nota }
 *
 * La ruta hace auth y nada más: la validación entera y las guardas viven
 * en lib/claims-write.ts, así la app móvil llama al mismo lib por el mismo
 * endpoint y no hay dos versiones de la regla.
 *
 * Hace falta CUENTA para reclamar, y es una decisión, no un detalle: el
 * reclamo se le aprueba A UNA CUENTA. Dejar un email sin cuenta crearía
 * reclamos que no se pueden aprobar sin inventarle una a alguien, y encima
 * sobre una dirección que nadie verificó.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { reclamarPerfil } from "@/lib/claims-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const actor = session?.user?.email;
  if (!actor) {
    return NextResponse.json(
      { error: "Necesitás una cuenta para reclamar un perfil" },
      { status: 401 }
    );
  }

  let body: { tipo?: unknown; slug?: unknown; nota?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const r = await reclamarPerfil(body.tipo, body.slug, body.nota, actor);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // Cambia la franja del perfil y el contador de la cola del admin.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...r.value });
}
