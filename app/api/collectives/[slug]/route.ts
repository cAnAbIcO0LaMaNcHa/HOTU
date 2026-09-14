/**
 * PATCH /api/collectives/[slug] — edit the collective's own information.
 *
 * Only the owner or a SUPER_ADMIN gets through, and the check lives in
 * lib/collectives-write so this route and the page that decides whether to
 * render the controls run the exact same rule.
 *
 * Body is a partial: { name?, bio?, sector? }. An absent key leaves the
 * column alone, so a form showing three fields cannot blank a fourth.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateCollectiveInfo } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: {
    name?: unknown;
    bio?: unknown;
    sector?: unknown;
    /** Solo venues. El lib rechaza estos dos si la fila es un colectivo. */
    address?: unknown;
    capacity?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const { slug } = await params;
  const result = await updateCollectiveInfo(slug, body, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, ...result.value });
}
