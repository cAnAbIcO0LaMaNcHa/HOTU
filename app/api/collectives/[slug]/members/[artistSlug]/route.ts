/**
 * DELETE /api/collectives/[slug]/members/[artistSlug] — take an artist out
 * of a collective.
 *
 * The membership is CLOSED with a to_date, never deleted: the history is
 * immutable, and a removed row would take the context of its sales with
 * it. Closes every active link the artist holds here, because "sacar del
 * colectivo" means that and not "leave the residency behind".
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { removeMember } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; artistSlug: string }> }
) {
  const { slug, artistSlug } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await removeMember(slug, artistSlug, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, closed: result.value.closed });
}
