/**
 * POST /api/artists/[slug]/press — agrega una nota de prensa al EPK.
 * El trabajo vive en lib/epk-galeria-write.ts; esto hace auth y forma.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crearNota } from "@/lib/epk-galeria-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

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

  const result = await crearNota(slug, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, id: result.value.id }, { status: 201 });
}
