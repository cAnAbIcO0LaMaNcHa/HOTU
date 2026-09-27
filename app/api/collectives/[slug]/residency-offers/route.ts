/**
 * Ofertas de residencia de UN colectivo (§8 fase 2).
 *
 *   GET   — las que están esperando respuesta. Para el panel del colectivo.
 *   POST  — ofrecerle la residencia a un DJ. Body: { artistSlug }
 *
 * QUIÉN PUEDE: puedeAdministrarColectivo, o sea el dueño y el SUPER_ADMIN, y
 * NO el residente. Es deliberado y es el centro de la fase 2: si un residente
 * pudiera ofrecer residencias, repartiría su propio permiso de edición y el
 * dueño se enteraría después. Un permiso que se propaga solo no es un permiso,
 * es una filtración.
 *
 * La lógica vive en lib/residency-offers-write.ts, que es el único archivo que
 * escribe kind='residente'. Acá solo se autentica y se traduce a HTTP.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  ofrecerResidencia,
  ofertasAbiertasDeColectivo,
} from "@/lib/residency-offers-write";
import { puedeAdministrarColectivo } from "@/lib/collectives-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  /**
   * La LISTA también va por puedeAdministrarColectivo y no es exceso: dice a
   * quién se le ofreció una residencia y no aceptó todavía. Eso es información
   * sobre una conversación entre el dueño y otra persona, y un residente no
   * tiene por qué verla.
   */
  if (!(await puedeAdministrarColectivo(slug, email))) {
    return NextResponse.json({ error: "No es tuyo" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, ofertas: await ofertasAbiertasDeColectivo(slug) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { artistSlug?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const artistSlug = typeof body?.artistSlug === "string" ? body.artistSlug.trim() : "";
  if (!artistSlug) {
    return NextResponse.json({ error: "artistSlug is required" }, { status: 400 });
  }

  const result = await ofrecerResidencia(slug, artistSlug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}
