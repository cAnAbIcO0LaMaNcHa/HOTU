/**
 * PUT    /api/genres/artist/[slug]     — fija el género de un artista
 * PUT    /api/genres/collective/[slug] — fija el de un colectivo
 * DELETE /api/genres/...               — lo borra
 *
 * PUT y no PATCH a propósito: el género de un perfil es un conjunto
 * completo, no campos sueltos. Se manda entero y reemplaza lo anterior,
 * porque "agregame un tag" tendría que revalidar igual las reglas de
 * cuántos hay y cuáles son primarios, y sería lo mismo con más pasos.
 *
 * El permiso lo resuelve lib/genres-write, el mismo que usa la página
 * para decidir si renderiza los controles. Una sola regla, un solo lugar.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearGenres, setGenres, type GenreOwner } from "@/lib/genres-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseOwner(value: string): GenreOwner | null {
  return value === "artist" || value === "collective" ? value : null;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ owner: string; slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { owner: rawOwner, slug } = await params;
  const owner = parseOwner(rawOwner);
  if (!owner) {
    return NextResponse.json(
      { error: "El tipo de perfil tiene que ser artist o collective" },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const result = await setGenres(
    owner,
    slug,
    {
      primaryBranch: String(b.primaryBranch ?? ""),
      secondaryBranches: Array.isArray(b.secondaryBranches)
        ? (b.secondaryBranches as unknown[]).map(String)
        : [],
      tags: Array.isArray(b.tags)
        ? (b.tags as Array<Record<string, unknown>>).map((t) => ({
            slug: String(t?.slug ?? ""),
            branchCode: String(t?.branchCode ?? ""),
          }))
        : [],
    },
    email
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ owner: string; slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { owner: rawOwner, slug } = await params;
  const owner = parseOwner(rawOwner);
  if (!owner) {
    return NextResponse.json(
      { error: "El tipo de perfil tiene que ser artist o collective" },
      { status: 404 }
    );
  }

  const result = await clearGenres(owner, slug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}
