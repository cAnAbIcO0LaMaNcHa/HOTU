/**
 * POST /api/upload — stores a profile image and returns its public URL.
 *
 * Upload only: it does not touch the artist row. The caller then sends the
 * returned URL through PATCH /api/artists/[slug], and that write is what
 * deletes the image it replaced (see lib/artists-write.ts). Keeping the
 * two apart means the mobile app uses the same two calls, and the deletion
 * rule lives in one place rather than in every upload path.
 *
 * multipart/form-data:
 *   file  — the image, already downscaled by the browser
 *   slug  — the artist profile it belongs to (decides who may upload)
 *   kind  — "avatar" | "cover", only used to organise the store
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canEditArtist } from "@/lib/artists-write";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  blobConfigured,
  uploadImage,
} from "@/lib/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "track-cover" covers artwork for both TRACKS and DJ SETS rows — one
 * budget, one folder, since both render at the same square size.
 */
const KINDS = ["avatar", "cover", "track-cover"] as const;
type Kind = (typeof KINDS)[number];

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Checked before doing any work so the UI can say "uploads are not
  // configured here" instead of failing with a generic 500 from put().
  if (!blobConfigured()) {
    return NextResponse.json(
      { error: "La subida de imágenes no está configurada en este entorno." },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Body must be multipart/form-data" }, { status: 400 });
  }

  const slug = String(form.get("slug") ?? "").trim();
  const kind = String(form.get("kind") ?? "") as Kind;
  const file = form.get("file");

  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  // Authorisation is the profile's, not the uploader's: the same rule that
  // guards the PATCH, so nobody can fill the store against a profile they
  // cannot edit.
  if (!(await canEditArtist(slug, email))) {
    return NextResponse.json({ error: "Not allowed to edit this profile" }, { status: 403 });
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return NextResponse.json(
      { error: `Formato no admitido. Usá ${ALLOWED_IMAGE_TYPES.join(", ")}.` },
      { status: 415 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `La imagen supera ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.` },
      { status: 413 }
    );
  }

  try {
    const url = await uploadImage(`artists/${slug}/${kind}`, file);
    return NextResponse.json({ ok: true, url }, { status: 201 });
  } catch (err) {
    console.error("[upload] put() failed", err);

    // A store created with private access rejects public blobs. An EPK
    // photo has to load for any visitor, so a private blob is no use here
    // — the fix is on the store, not in this code, and saying so beats a
    // generic failure that looks like a bug.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("private store") || message.includes("private access")) {
      return NextResponse.json(
        {
          error:
            "El blob store está configurado como privado y las fotos del EPK son públicas. Cambiá el store a acceso público en Vercel.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 502 });
  }
}
