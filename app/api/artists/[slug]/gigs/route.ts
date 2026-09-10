/**
 * POST /api/artists/[slug]/gigs — declare a gig played outside HOTU.
 *
 * Only declared gigs can be created here. A gig at a HOTU event enters by
 * itself from the lineup, and lib/epk-write.ts hard-codes source and
 * ignores any event_id in the body — if an artist could hand-write a row
 * pointing at a HOTU event, the difference between a verified and a
 * declared gig would stop meaning anything to an organiser.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createDeclaredGig } from "@/lib/epk-write";

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

  const result = await createDeclaredGig(slug, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, id: result.value.id }, { status: 201 });
}
