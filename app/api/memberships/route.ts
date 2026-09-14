/**
 * POST /api/memberships — open a membership conversation.
 *
 * Body: { collectiveSlug, artistSlug, requestedBy: "artist" | "collective" }
 *
 * One endpoint for both directions on purpose: a DJ applying and a
 * collective inviting produce the same pending row, differing only in who
 * started it. Two endpoints would be the same code twice.
 *
 * requestedBy is verified, never trusted: lib/membership-write checks that
 * the caller actually owns the side they claim to speak for.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requestMembership, type RequestedBy } from "@/lib/membership-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { collectiveSlug?: unknown; artistSlug?: unknown; requestedBy?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const collectiveSlug =
    typeof body.collectiveSlug === "string" ? body.collectiveSlug.trim() : "";
  const artistSlug = typeof body.artistSlug === "string" ? body.artistSlug.trim() : "";
  if (!collectiveSlug || !artistSlug) {
    return NextResponse.json(
      { error: "collectiveSlug y artistSlug son obligatorios" },
      { status: 400 }
    );
  }

  const result = await requestMembership(
    collectiveSlug,
    artistSlug,
    body.requestedBy as RequestedBy,
    email
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, id: result.value.id }, { status: 201 });
}
