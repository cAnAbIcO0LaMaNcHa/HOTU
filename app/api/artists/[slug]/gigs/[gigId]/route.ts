/**
 * DELETE /api/artists/[slug]/gigs/[gigId] — remove a declared gig.
 *
 * A gig sourced from a HOTU lineup is refused: it records a booking that
 * happened rather than profile content, and it would come back from the
 * lineup anyway.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteDeclaredGig } from "@/lib/epk-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; gigId: string }> }
) {
  const { slug, gigId } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = Number(gigId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "gigId must be a positive integer" }, { status: 400 });
  }

  const result = await deleteDeclaredGig(slug, id, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true });
}
