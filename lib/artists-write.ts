/**
 * Write logic for the artist profile (EPK).
 *
 * Per the repo rule, this module holds the work and app/api/artists/[slug]
 * exposes it over HTTP — no component writes directly. The mobile app will
 * call the same endpoint, so nothing here may depend on a Next request
 * context: the caller passes the acting email in.
 *
 * Node-only. Never import from a client component.
 */

import { neon } from "@neondatabase/serverless";
import { SOCIAL_PLATFORMS, type ArtistSocials, type SocialPlatform } from "./db";
import { isSuperAdmin } from "./roles-check";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Everything a DJ may change about their own profile.
 *
 * Deliberately absent: anything derived from sales. Attribution numbers are
 * the whole value of the press kit — an organiser can only trust them
 * because the artist cannot touch them. Also absent: slug, district, status
 * and dj_code, which are identity and editorial decisions rather than
 * profile content.
 */
export type ArtistProfilePatch = {
  name?: string;
  role?: string;
  genre?: string;
  city?: string;
  origin?: string;
  bio?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  photo?: string | null;
  coverUrl?: string | null;
  bpmMin?: number | null;
  bpmMax?: number | null;
  socials?: ArtistSocials;
};

export type WriteResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * True when `email` owns this artist profile, or is a SUPER_ADMIN.
 *
 * Used twice: by the API route to authorise the write, and by the profile
 * page to decide whether to render the edit affordances at all. Both must
 * agree, so they call the same function — hiding a button is presentation,
 * never protection.
 */
export async function canEditArtist(slug: string, email?: string | null): Promise<boolean> {
  if (!email) return false;
  const rows = await sql`SELECT owner_email FROM artists WHERE slug = ${slug}`;
  if (rows.length === 0) return false;
  const owner = rows[0].owner_email as string | null;
  if (owner && owner.toLowerCase() === email.toLowerCase()) return true;
  return await isSuperAdmin(email);
}

const MAX_LENGTHS: Record<string, number> = {
  name: 80,
  role: 60,
  genre: 40,
  city: 80,
  origin: 80,
  bio: 4000,
  contactEmail: 160,
  contactPhone: 40,
  photo: 2000,
  coverUrl: 2000,
};

/** Empty string from a cleared input means "unset", not "store a blank". */
function cleanText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Only http(s) links are accepted. Without this a stored "javascript:" URL
 * would be rendered straight into an href on a public profile.
 */
function cleanUrl(value: unknown): string | null | undefined {
  const text = cleanText(value);
  if (text === undefined || text === null) return text;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function cleanSocials(value: unknown): ArtistSocials | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const out: ArtistSocials = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const url = cleanUrl(input[platform]);
    // undefined = not sent or invalid, null = cleared. Both mean "no link".
    if (typeof url === "string") out[platform as SocialPlatform] = url;
  }
  return out;
}

/**
 * Applies a patch to an artist profile after checking that `actorEmail` is
 * allowed to. Returns a typed result instead of throwing so the API route
 * can map it to a status code without pattern-matching on error strings.
 */
export async function updateArtistProfile(
  slug: string,
  patch: ArtistProfilePatch,
  actorEmail?: string | null
): Promise<WriteResult> {
  const rows = await sql`SELECT slug FROM artists WHERE slug = ${slug}`;
  if (rows.length === 0) return { ok: false, status: 404, error: "Artist not found" };

  if (!(await canEditArtist(slug, actorEmail))) {
    return { ok: false, status: 403, error: "Not allowed to edit this profile" };
  }

  // name, genre, city and bio are NOT NULL in the table, so an explicit
  // clear has to be rejected rather than written as null.
  const required: Array<keyof ArtistProfilePatch> = ["name", "genre", "city", "bio"];
  const values: Record<string, string | number | null> = {};

  for (const key of ["name", "role", "genre", "city", "origin", "bio", "contactEmail", "contactPhone"] as const) {
    const cleaned = cleanText(patch[key]);
    if (cleaned === undefined) continue;
    if (cleaned === null && required.includes(key)) {
      return { ok: false, status: 400, error: `${key} cannot be empty` };
    }
    const max = MAX_LENGTHS[key];
    if (cleaned !== null && max && cleaned.length > max) {
      return { ok: false, status: 400, error: `${key} is longer than ${max} characters` };
    }
    values[key] = cleaned;
  }

  for (const key of ["photo", "coverUrl"] as const) {
    if (patch[key] === undefined) continue;
    const cleaned = cleanUrl(patch[key]);
    if (cleaned === undefined) {
      return { ok: false, status: 400, error: `${key} must be an http(s) URL` };
    }
    values[key] = cleaned;
  }

  for (const key of ["bpmMin", "bpmMax"] as const) {
    const raw = patch[key];
    if (raw === undefined) continue;
    if (raw === null) {
      values[key] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 60 || n > 300) {
      return { ok: false, status: 400, error: `${key} must be a whole number between 60 and 300` };
    }
    values[key] = n;
  }

  const min = values.bpmMin ?? null;
  const max = values.bpmMax ?? null;
  if (typeof min === "number" && typeof max === "number" && min > max) {
    return { ok: false, status: 400, error: "bpmMin cannot be greater than bpmMax" };
  }

  const socials = patch.socials === undefined ? undefined : cleanSocials(patch.socials);
  if (patch.socials !== undefined && socials === undefined) {
    return { ok: false, status: 400, error: "socials must be an object of platform -> URL" };
  }

  if (Object.keys(values).length === 0 && socials === undefined) {
    return { ok: false, status: 400, error: "Nothing to update" };
  }

  // COALESCE keeps every column the patch did not mention untouched, so a
  // partial save from one section never wipes another section's fields.
  await sql`
    UPDATE artists SET
      name          = COALESCE(${values.name ?? null}, name),
      genre         = COALESCE(${values.genre ?? null}, genre),
      city          = COALESCE(${values.city ?? null}, city),
      bio           = COALESCE(${values.bio ?? null}, bio),
      origin        = CASE WHEN ${"origin" in values} THEN ${values.origin ?? null}::text ELSE origin END,
      role          = CASE WHEN ${"role" in values} THEN ${values.role ?? null}::text ELSE role END,
      contact_email = CASE WHEN ${"contactEmail" in values} THEN ${values.contactEmail ?? null}::text ELSE contact_email END,
      contact_phone = CASE WHEN ${"contactPhone" in values} THEN ${values.contactPhone ?? null}::text ELSE contact_phone END,
      photo         = CASE WHEN ${"photo" in values} THEN ${values.photo ?? null}::text ELSE photo END,
      cover_url     = CASE WHEN ${"coverUrl" in values} THEN ${values.coverUrl ?? null}::text ELSE cover_url END,
      bpm_min       = CASE WHEN ${"bpmMin" in values} THEN ${values.bpmMin ?? null}::smallint ELSE bpm_min END,
      bpm_max       = CASE WHEN ${"bpmMax" in values} THEN ${values.bpmMax ?? null}::smallint ELSE bpm_max END,
      socials       = CASE WHEN ${socials !== undefined} THEN ${JSON.stringify(socials ?? {})}::jsonb ELSE socials END
    WHERE slug = ${slug}
  `;

  return { ok: true };
}
