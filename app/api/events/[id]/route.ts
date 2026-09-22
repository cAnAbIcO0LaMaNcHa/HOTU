/**
 * PATCH  /api/events/[id] — el organizador corrige su evento.
 * DELETE /api/events/[id] — el organizador lo baja del todo.
 *
 * Existe porque el admin dejó de editar contenido ajeno. Sin esto, una
 * fiesta publicada con la fecha mal quedaba así para siempre, y el sitio
 * terminaba peor que antes de la tanda.
 *
 * Bajar del sitio SIN borrar es otra cosa y es del moderador: eso es la
 * censura, en /api/admin/moderation/content.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { deleteCommunityEvent, updateCommunityEvent } from "@/lib/events-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function leerId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = leerId((await params).id);
  if (id === null) return NextResponse.json({ error: "No encontré ese evento" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await updateCommunityEvent(id, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, ...result.value });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = leerId((await params).id);
  if (id === null) return NextResponse.json({ error: "No encontré ese evento" }, { status: 404 });

  const result = await deleteCommunityEvent(id, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, ...result.value });
}
