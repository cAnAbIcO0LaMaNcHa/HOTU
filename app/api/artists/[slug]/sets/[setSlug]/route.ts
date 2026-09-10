/**
 * DELETE /api/artists/[slug]/sets/[setSlug] — remove a set from the EPK.
 * The delete is scoped to the artist in lib/epk-write.ts, so an owner
 * cannot reach another profile's set by guessing its slug.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteSet } from "@/lib/epk-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
