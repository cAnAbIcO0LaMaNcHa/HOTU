/**
 * POST /api/artists/[slug]/photos — agrega una foto a la galería del EPK.
 * PUT  /api/artists/[slug]/photos — reemplaza el ORDEN de la galería entera.
 *
 * El trabajo vive en lib/epk-galeria-write.ts; esto hace auth y forma.
 *
 * EL REORDEN ES UN PUT A LA COLECCIÓN y no un PATCH por fila, por dos razones. La primera
 * es semántica: mover una foto cambia la posición de varias, así que lo que se reemplaza es
 * el orden de la lista, no un campo de un elemento. La segunda es de rutas: un
 * /photos/orden sería un segmento estático al lado de /photos/[photoId], y aunque Next
 * resuelve el estático primero, es una precedencia que hay que saber para leer el código.
 * Un PUT a la colección no tiene esa ambigüedad.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crearFoto, reordenarFotos } from "@/lib/epk-galeria-write";

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

  const result = await crearFoto(slug, c.body, email);
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

  const result = await reordenarFotos(slug, c.body.ids, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, movidas: result.value.movidas });
}
