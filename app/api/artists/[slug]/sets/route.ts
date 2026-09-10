/**
 * POST /api/artists/[slug]/sets — add a recorded set to the EPK.
 * Work lives in lib/epk-write.ts; this only does auth and shape.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSet } from "@/lib/epk-write";

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

  const result = await createSet(slug, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, slug: result.value.slug }, { status: 201 });
}
