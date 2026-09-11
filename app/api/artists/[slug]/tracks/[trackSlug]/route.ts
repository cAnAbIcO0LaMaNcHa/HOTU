/**
 * DELETE /api/artists/[slug]/tracks/[trackSlug] — remove a track from the
 * EPK. Scoped to the artist in lib/epk-write.ts.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteTrack, updateTrack, type TrackPatch } from "@/lib/epk-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH — edit an existing track: title, date, link, cover, label, order. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; trackSlug: string }> }
) {
  const { slug, trackSlug } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: TrackPatch;
  try {
    body = (await request.json()) as TrackPatch;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await updateTrack(slug, trackSlug, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true });
}

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
