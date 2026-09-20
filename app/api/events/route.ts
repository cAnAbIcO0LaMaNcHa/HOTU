/**
 * POST /api/events — publicar un evento desde el panel (tanda 5 §3).
 *
 * Body: { organizerSlug, title, date, venue?, city?, lineup?, endAt?, flyerUrl? }
 *
 * La ruta hace sesión y forma; el permiso y las reglas del evento están
 * en lib/events-write.ts, que es lo que va a llamar también la app.
 *
 * No hay GET: las lecturas de eventos ya salen de server components por
 * lib/db.ts y no hacen falta por HTTP todavía.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { createCommunityEvent } from "@/lib/events-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await createCommunityEvent(body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // El evento sale publicado, así que la agenda y la home tienen que
  // dejar de servir la versión cacheada sin él. Va acá y no en el lib
  // porque revalidatePath es del request de Next: la app móvil llama al
  // mismo lib y no tiene nada que revalidar.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...result.value }, { status: 201 });
}
