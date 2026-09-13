/**
 * POST /api/collectives/[slug]/members — add an artist to a collective.
 *
 * Body: { artistSlug, kind: "residente" | "toca_con" }
 *
 * Work lives in lib/collectives-write.ts; this does auth and shape only.
 * Adding a resident is refused with a 409 that names the collective the
 * artist is already resident of — the partial unique index would reject it
 * regardless, but a constraint violation is not an answer.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addMember, type MembershipKind } from "@/lib/collectives-write";

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

  let body: { artistSlug?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const artistSlug = typeof body.artistSlug === "string" ? body.artistSlug.trim() : "";
  if (!artistSlug) {
    return NextResponse.json({ error: "artistSlug is required" }, { status: 400 });
  }

  const result = await addMember(slug, artistSlug, body.kind as MembershipKind, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true }, { status: 201 });
}
