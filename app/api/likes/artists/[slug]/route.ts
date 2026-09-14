/**
 * POST   /api/likes/artists/[slug] — like this artist
 * DELETE /api/likes/artists/[slug] — remove the like
 *
 * The like always belongs to the caller's own session email. There is no
 * body and no user parameter, precisely so one account can never like or
 * unlike on behalf of another.
 *
 * Both verbs are idempotent and answer with the resulting state plus the
 * new count, so the button can settle without a second request.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { likeArtist, unlikeArtist } from "@/lib/likes-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { slug } = await params;
  const result = await likeArtist(slug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { slug } = await params;
  const result = await unlikeArtist(slug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...result.value });
}
