"use server";

import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

const sql = neon(process.env.DATABASE_URL!);

function refreshAll() {
  revalidatePath("/", "layout");
}

/**
 * Uploads the "flyer" file field to Vercel Blob if one was actually
 * chosen, returning its public URL. Returns undefined if the field was
 * left empty, so callers can tell "no new file" apart from "clear it" —
 * useful on update, where an empty file input should leave the existing
 * flyer alone rather than wiping it.
 */
async function uploadFlyerIfPresent(formData: FormData): Promise<string | undefined> {
  const file = formData.get("flyer");
  if (!(file instanceof File) || file.size === 0) return undefined;
  const blob = await put(`flyers/${Date.now()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });
  return blob.url;
}

/** Normalises a <input type="datetime-local"> value ("2026-08-27T05:00")
 * to an ISO timestamp, or null if the field was left empty. */
function readEndAt(formData: FormData): string | null {
  const raw = String(formData.get("endAt") ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Reads the shared editorial fields out of a form submission. */
function readMeta(formData: FormData) {
  const scope = String(formData.get("scope") ?? "country");
  const countryCode = scope === "global" ? "" : String(formData.get("countryCode") ?? "COL");
  const language = String(formData.get("language") ?? "es");
  const status = String(formData.get("status") ?? "published");
  const featured = formData.get("featured") === "on";
  // While featured, priority_at carries a timestamp so it can be ranked
  // against other featured items; the moment it's unfeatured, priority_at
  // goes back to null and normal date ordering takes over automatically.
  const priorityAt = featured ? new Date().toISOString() : null;
  return { scope, countryCode, language, status, featured, priorityAt };
}

export async function createEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  const endAt = readEndAt(formData);
  const flyerUrl = (await uploadFlyerIfPresent(formData)) ?? null;
  await sql`
    INSERT INTO events (event_date, end_at, flyer_url, city, venue, title, lineup, district, scope, country_code, language, status, featured, priority_at)
    VALUES (${String(formData.get("date"))}, ${endAt}, ${flyerUrl}, ${String(formData.get("city"))}, ${String(formData.get("venue"))}, ${String(formData.get("title"))}, ${String(formData.get("lineup"))}, ${String(formData.get("district"))}, ${m.scope}, ${m.countryCode}, ${m.language}, ${m.status}, ${m.featured}, ${m.priorityAt})
  `;
  refreshAll();
}

export async function updateEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  const endAt = readEndAt(formData);
  // Undefined means "no new file chosen" — keep whatever flyer_url is
  // already there instead of overwriting it with null.
  const newFlyerUrl = await uploadFlyerIfPresent(formData);
  if (newFlyerUrl !== undefined) {
    await sql`
      UPDATE events SET
        event_date = ${String(formData.get("date"))},
        end_at = ${endAt},
        flyer_url = ${newFlyerUrl},
        city = ${String(formData.get("city"))},
        venue = ${String(formData.get("venue"))},
        title = ${String(formData.get("title"))},
        lineup = ${String(formData.get("lineup"))},
        district = ${String(formData.get("district"))},
        scope = ${m.scope},
        country_code = ${m.countryCode},
        language = ${m.language},
        status = ${m.status},
        featured = ${m.featured},
        priority_at = ${m.priorityAt}
      WHERE id = ${Number(formData.get("id"))}
    `;
  } else {
    await sql`
      UPDATE events SET
        event_date = ${String(formData.get("date"))},
        end_at = ${endAt},
        city = ${String(formData.get("city"))},
        venue = ${String(formData.get("venue"))},
        title = ${String(formData.get("title"))},
        lineup = ${String(formData.get("lineup"))},
        district = ${String(formData.get("district"))},
        scope = ${m.scope},
        country_code = ${m.countryCode},
        language = ${m.language},
        status = ${m.status},
        featured = ${m.featured},
        priority_at = ${m.priorityAt}
      WHERE id = ${Number(formData.get("id"))}
    `;
  }
  refreshAll();
}

export async function deleteEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`DELETE FROM events WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}

export async function createNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  await sql`
    INSERT INTO news (tag, news_date, title, excerpt, district, scope, country_code, language, status, featured, priority_at)
    VALUES (${String(formData.get("tag"))}, ${String(formData.get("date"))}, ${String(formData.get("title"))}, ${String(formData.get("excerpt"))}, ${String(formData.get("district"))}, ${m.scope}, ${m.countryCode}, ${m.language}, ${m.status}, ${m.featured}, ${m.priorityAt})
  `;
  refreshAll();
}

export async function updateNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  await sql`
    UPDATE news SET
      tag = ${String(formData.get("tag"))},
      news_date = ${String(formData.get("date"))},
      title = ${String(formData.get("title"))},
      excerpt = ${String(formData.get("excerpt"))},
      district = ${String(formData.get("district"))},
      scope = ${m.scope},
      country_code = ${m.countryCode},
      language = ${m.language},
      status = ${m.status},
      featured = ${m.featured},
      priority_at = ${m.priorityAt}
    WHERE id = ${Number(formData.get("id"))}
  `;
  refreshAll();
}

export async function deleteNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`DELETE FROM news WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}

/** Comma-separated slugs like "nina-acid, subsuelo-x" -> ["nina-acid", "subsuelo-x"]. */
function readArtistSlugs(formData: FormData): string[] {
  return String(formData.get("artistSlugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createCollective(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  const artistSlugs = readArtistSlugs(formData);
  await sql`
    INSERT INTO collectives (slug, name, type, sector, bio, artist_slugs, district, scope, country_code, language, status, featured, priority_at)
    VALUES (${String(formData.get("slug"))}, ${String(formData.get("name"))}, ${String(formData.get("type"))}, ${String(formData.get("sector"))}, ${String(formData.get("bio"))}, ${JSON.stringify(artistSlugs)}, ${String(formData.get("district"))}, ${m.scope}, ${m.countryCode}, ${m.language}, ${m.status}, ${m.featured}, ${m.priorityAt})
  `;
  refreshAll();
}

export async function updateCollective(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const m = readMeta(formData);
  const artistSlugs = readArtistSlugs(formData);
  await sql`
    UPDATE collectives SET
      name = ${String(formData.get("name"))},
      type = ${String(formData.get("type"))},
      sector = ${String(formData.get("sector"))},
      bio = ${String(formData.get("bio"))},
      artist_slugs = ${JSON.stringify(artistSlugs)},
      district = ${String(formData.get("district"))},
      scope = ${m.scope},
      country_code = ${m.countryCode},
      language = ${m.language},
      status = ${m.status},
      featured = ${m.featured},
      priority_at = ${m.priorityAt}
    WHERE slug = ${String(formData.get("originalSlug"))}
  `;
  refreshAll();
}

export async function deleteCollective(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`DELETE FROM collectives WHERE slug = ${String(formData.get("slug"))}`;
  refreshAll();
}
