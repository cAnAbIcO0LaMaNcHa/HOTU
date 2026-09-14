/**
 * POST /api/collectives — found a collective from a DJ's account (§4.1).
 *
 * Body: { name }. Everything else is derived: the caller's session decides
 * the owner, and their artist profile seeds the city and district. Nothing
 * about who owns it is taken from the request.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createCollective } from "@/lib/collectives-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await createCollective(body.name, email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, ...result.value }, { status: 201 });
}
