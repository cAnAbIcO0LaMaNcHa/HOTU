/**
 * The EPK's social platforms. Pure data, no imports.
 *
 * This lives outside lib/db.ts because the header is a client component and
 * needs the list at runtime, not just as a type. lib/db.ts calls
 * neon(process.env.DATABASE_URL!) at module scope, so importing any *value*
 * from it pulls the database client into the browser bundle — the exact bug
 * the repo rule about lib/db.ts and client components exists for. Same
 * reasoning as lib/date-utils.ts.
 *
 * lib/db.ts re-exports these, so server-side callers can keep importing
 * from there.
 */

export const SOCIAL_PLATFORMS = [
  "spotify",
  "beatport",
  "soundcloud",
  "instagram",
  "tiktok",
  "youtube",
  "shazam",
  "appleMusic",
  "web",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type ArtistSocials = Partial<Record<SocialPlatform, string>>;

/** Display names for the social row. */
export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  spotify: "Spotify",
  beatport: "Beatport",
  soundcloud: "SoundCloud",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  shazam: "Shazam",
  appleMusic: "Apple Music",
  web: "Web",
};
