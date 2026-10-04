/**
 * POST /api/artists/[slug]/press — agrega una nota de prensa al EPK.
 * PUT  /api/artists/[slug]/press — reemplaza el ORDEN de la lista entera.
 *
 * Mismo criterio que las fotos: el reorden es un PUT a la colección, porque mover una nota
 * cambia la posición de varias.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crearNota, reordenarNotas } from "@/lib/epk-galeria-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function cuerpo(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "Body must be JSON" as const };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Body must be a JSON object" as const };
  }
  return { body: body as Record<string, unknown> };
}

export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const c = await cuerpo(request);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });

  const result = await crearNota(slug, c.body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, id: result.value.id }, { status: 201 });
}

export async function PUT(request: Request, { params }: Ctx) {
  const { slug } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const c = await cuerpo(request);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });

  const result = await reordenarNotas(slug, c.body.ids, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, movidas: result.value.movidas });
}
