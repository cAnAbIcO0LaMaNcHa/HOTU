/**
 * Browser-side image downscaling, run before anything is uploaded.
 *
 * A phone photo is 4-8 MB; the free Blob tier is 1 GB. Uploading originals
 * would burn through it in a couple of hundred profile edits, so the
 * canvas pass is not an optimisation, it is what makes the storage budget
 * work. It also means the upload endpoint normally receives a file well
 * under its own limit.
 *
 * Pure browser code — no imports, no database, safe in a client component.
 */

/** Longest-edge targets, in CSS pixels. */
export const IMAGE_TARGETS = {
  avatar: 800,
  cover: 1600,
  /** For track artwork, once tanda 2 adds the column. */
  trackCover: 1000,
  /**
   * El flyer de un evento. Mismo presupuesto que una portada, pero con
   * nombre propio: es un afiche vertical con texto chico —fecha, line
   * up, dirección— y si alguna vez hay que subirlo, hay que poder
   * hacerlo sin tocar de paso las portadas del EPK.
   */
  flyer: 1600,
} as const;

export type ImageTarget = keyof typeof IMAGE_TARGETS;

const QUALITY = 0.85;

/**
 * Decodes the file, honouring EXIF orientation so a portrait phone photo
 * does not arrive sideways. createImageBitmap is the fast path; the
 * <img> fallback covers browsers without it (and Safari versions that
 * ignore imageOrientation).
 */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // fall through to the <img> path
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No se pudo leer la imagen"));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Returns a resized webp copy of `file`, never larger than `maxDimension`
 * on its longest edge. Images already smaller than the target are not
 * upscaled, but they are still re-encoded — a 5 MB 600px PNG is exactly
 * the case the quality pass exists for.
 *
 * Falls back to JPEG where webp encoding is unavailable, and returns the
 * original file untouched if the canvas produces nothing, so a failure
 * here degrades to "uploads the original" rather than blocking the edit.
 */
export async function resizeImageFile(file: File, maxDimension: number): Promise<File> {
  const { source, width, height } = await decode(file);
  if (!width || !height) return file;

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  let blob = await toBlob(canvas, "image/webp");
  let extension = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await toBlob(canvas, "image/jpeg");
    extension = "jpg";
  }
  if (!blob) return file;

  const base = file.name.replace(/\.[^.]+$/, "") || "imagen";
  return new File([blob], `${base}.${extension}`, { type: blob.type });
}
