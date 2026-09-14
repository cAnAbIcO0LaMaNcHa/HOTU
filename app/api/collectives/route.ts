/**
 * POST /api/collectives — found a collective or a venue from a DJ's
 * account (§4.1 y §5).
 *
 * Body: { name, entityKind? }. Todo lo demás se deriva: la sesión decide
 * el dueño, y el perfil de artista siembra la ciudad y el distrito. Nada
 * sobre quién es el dueño sale del request.
 *
 * entityKind por defecto es 'collective'. Un venue hay que pedirlo
 * explícitamente, así que un cliente viejo que no sepa del campo sigue
 * creando colectivos y nunca abre un venue sin querer.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createCollective } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { name?: unknown; entityKind?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  if (
    body.entityKind !== undefined &&
    body.entityKind !== "collective" &&
    body.entityKind !== "venue"
  ) {
    return NextResponse.json(
      { error: "entityKind tiene que ser 'collective' o 'venue'" },
      { status: 400 }
    );
  }
  const entityKind = (body.entityKind as "collective" | "venue") ?? "collective";

  const result = await createCollective(body.name, email, entityKind);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, ...result.value }, { status: 201 });
}
