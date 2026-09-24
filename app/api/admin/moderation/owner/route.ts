/**
 * GET   /api/admin/moderation/owner?tipo=&slug= — qué se va a mover.
 * PATCH /api/admin/moderation/owner              — moverlo.
 *
 * El GET existe para que el formulario pueda MOSTRAR qué administra hoy
 * la cuenta dueña antes de que el moderador confirme. Siete de las
 * cuentas fantasma administran un artista y un colectivo, y el traspaso
 * se los lleva a los dos: eso tiene que verse antes, no descubrirse
 * después.
 *
 * Body del PATCH: { tipo: "artist" | "collective", slug, email, motivo }
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isModerator } from "@/lib/roles-check";
import { queAdministraElDuenoDe, reasignarDueno } from "@/lib/moderation-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // La comprobación va acá y no en el lib: es una lectura, y el lib de
  // escritura no tiene por qué exponer una consulta sin guarda.
  if (!(await isModerator(email))) {
    return NextResponse.json({ error: "Solo un moderador" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get("tipo");
  const slug = searchParams.get("slug") ?? "";
  if (tipo !== "artist" && tipo !== "collective") {
    return NextResponse.json(
      { error: "tipo tiene que ser 'artist' o 'collective'" },
      { status: 400 }
    );
  }

  const r = await queAdministraElDuenoDe(tipo, slug);
  if (!r) return NextResponse.json({ error: "No encontré ese perfil" }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}

export async function PATCH(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: {
    tipo?: unknown;
    slug?: unknown;
    email?: unknown;
    motivo?: unknown;
    /** El modo que el formulario mostró, para que el lib pueda negarse
     *  si la cuenta cambió de clasificación en el medio. */
    modo?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const modo = body.modo === "todo" || body.modo === "solo_nombrado" ? body.modo : undefined;
  const r = await reasignarDueno(body.tipo, body.slug, body.email, body.motivo, email, modo);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // Cambia quién puede editar qué, y el press kit muestra al dueño cosas
  // que a un visitante le esconde.
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, ...r.value });
}
