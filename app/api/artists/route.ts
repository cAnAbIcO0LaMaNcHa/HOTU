/**
 * POST /api/artists — crear el perfil de DJ de una cuenta (ALTA-DJ paso 3).
 * GET  /api/artists?djCode=X&name=Y — disponibilidad, para el formulario.
 *
 * El dueño sale de la sesión y de ningún otro lado: no hay ningún campo
 * del cuerpo que diga de quién es el perfil.
 *
 * El GET existe porque el código de DJ y la dirección del perfil son
 * únicos y el formulario tiene que poder decirlo ANTES de enviar. Pedir
 * un nombre, completar seis campos más y recién ahí enterarse de que el
 * código estaba tomado es la forma de que alguien abandone.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createArtist,
  djCodeLibre,
  proponerDjCode,
  slugDeNombre,
  slugLibreDesde,
} from "@/lib/artists-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disponibilidad. Requiere sesión: sin eso sería un oráculo público para
 * enumerar qué códigos de DJ existen, y el código de DJ es lo que mañana
 * atribuye las ventas.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const name = (searchParams.get("name") ?? "").trim();
  const djCode = (searchParams.get("djCode") ?? "").trim();

  const respuesta: Record<string, unknown> = {};

  if (name) {
    // Lo que el formulario muestra como "tu dirección va a ser esta".
    respuesta.slug = await slugLibreDesde(slugDeNombre(name));
    respuesta.djCodeSugerido = proponerDjCode(name);
  }

  if (djCode) {
    const valido = /^[A-Za-z]{3,12}$/.test(djCode);
    respuesta.djCode = djCode.toUpperCase();
    respuesta.djCodeValido = valido;
    respuesta.djCodeLibre = valido ? await djCodeLibre(djCode) : false;
  }

  return NextResponse.json(respuesta);
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await createArtist(
    {
      name: body.name,
      djCode: body.djCode,
      city: body.city,
      origin: body.origin,
      primaryBranch: body.primaryBranch,
      secondaryBranches: body.secondaryBranches,
      tags: body.tags,
    },
    email
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, ...result.value }, { status: 201 });
}
