/**
 * PATCH /api/artists/[slug] — save edits to an artist's EPK.
 *
 * This is the write path for the profile. Per the repo rule every write
 * goes through an API route rather than a Server Action, because the mobile
 * app has to be able to call exactly this endpoint; the work itself lives
 * in lib/artists-write.ts so the site and the app share one implementation.
 *
 * Auth is the session's email. The route never trusts a caller-supplied
 * identity — an "actor" field in the body would let anyone edit any profile.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateArtistProfile, type ArtistProfilePatch } from "@/lib/artists-write";
import { getArtistBySlug } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let patch: ArtistProfilePatch;
  try {
    patch = (await request.json()) as ArtistProfilePatch;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const result = await updateArtistProfile(slug, patch, email);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Return the saved profile so the caller can render from the database's
  // version rather than from what it hoped it wrote.
  //
  // Con el email de quien escribe: si el perfil está en borrador, sin eso
  // esta relectura devolvería undefined y el dueño recibiría un cuerpo
  // vacío justo después de guardar bien.
  const artist = await getArtistBySlug(slug, email);
  return NextResponse.json({ ok: true, artist });
}
