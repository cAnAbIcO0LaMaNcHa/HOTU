/**
 * DELETE /api/artists/[slug]/sets/[setSlug] — remove a set from the EPK.
 * The delete is scoped to the artist in lib/epk-write.ts, so an owner
 * cannot reach another profile's set by guessing its slug.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteSet, updateSet, type SetPatch } from "@/lib/epk-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH — edit an existing set. An absent field is left alone. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; setSlug: string }> }
) {
  const { slug, setSlug } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: SetPatch;
  try {
    body = (await request.json()) as SetPatch;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await updateSet(slug, setSlug, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; setSlug: string }> }
) {
  const { slug, setSlug } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await deleteSet(slug, setSlug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true });
}
