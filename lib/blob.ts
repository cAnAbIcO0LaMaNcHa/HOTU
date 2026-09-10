/**
 * Vercel Blob helpers for profile images.
 *
 * Server-only: never import from a client component.
 *
 * Everything here tolerates a missing BLOB_READ_WRITE_TOKEN. The token is
 * confirmed locally but still pending on Vercel, so an environment without
 * it must degrade to "uploads unavailable" rather than crash a profile
 * save or a page render.
 */

import { del, put } from "@vercel/blob";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Server-side ceiling. The browser resizes and re-encodes to webp before
 * uploading, so a legitimate file arrives well under this; the limit is
 * here for anything that talks to the endpoint directly.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * The public host of OUR store, derived from the token, which has the
 * shape vercel_blob_rw_<STOREID>_<SECRET>.
 *
 * Deriving it beats hardcoding a hostname (nothing to keep in sync, and no
 * infrastructure detail in the repo) and it beats matching
 * *.public.blob.vercel-storage.com, which would also match somebody else's
 * store. Only the store id is used; the secret half is never touched.
 */
function ownBlobHost(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const parts = token.split("_");
  if (parts.length < 5 || !parts[3]) return null;
  return `${parts[3].toLowerCase()}.public.blob.vercel-storage.com`;
}

/**
 * Whether this URL is a file we uploaded, and may therefore delete.
 *
 * This is the guard that keeps the cleanup honest: a DJ can paste any
 * image URL into the profile, and deleting a replaced value blindly would
 * mean issuing del() against somebody else's address. Only our own host
 * counts.
 */
export function isOwnBlobUrl(url?: string | null): boolean {
  const host = ownBlobHost();
  if (!host || !url) return false;
  try {
    return new URL(url).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * Deletes a replaced image, but only when we own it.
 *
 * Never throws: losing a blob is a storage-cost problem, while a throw
 * here would fail the profile save that already succeeded in the database.
 * A failure is logged so it can be reconciled later.
 */
export async function deleteOwnBlob(url?: string | null): Promise<void> {
  if (!url || !isOwnBlobUrl(url) || !blobConfigured()) return;
  try {
    await del(url);
  } catch (err) {
    console.error("[blob] could not delete replaced image", url, err);
  }
}

/**
 * Stores an image and returns its public URL. addRandomSuffix keeps a
 * re-upload under the same name from overwriting the previous file, which
 * matters because the old URL may still be referenced until the profile
 * save lands.
 */
export async function uploadImage(pathname: string, file: File): Promise<string> {
  const blob = await put(pathname, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type,
  });
  return blob.url;
}
