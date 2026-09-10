/**
 * DELETE /api/artists/[slug]/tracks/[trackSlug] — remove a track from the
 * EPK. Scoped to the artist in lib/epk-write.ts.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteTrack } from "@/lib/epk-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; trackSlug: string }> }
) {
  const { slug, trackSlug } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await deleteTrack(slug, trackSlug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true });
}
