/** Postgres DATE columns come back as Date objects; normalise to YYYY-MM-DD. */
export function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Format a date as DD.MM.YY for the compact event/news labels. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

/**
 * Whether an event is over, for archiving purposes. If it has an explicit
 * end_at timestamp, that decides it exactly (handles parties that run past
 * midnight). Otherwise it falls back to the end of the event's calendar
 * day — the old behaviour, kept for events nobody has set a close time on.
 *
 * Deliberately has NO import of "@/lib/db" or "neon" — this file only ever
 * does pure date math, so client components (event/track lists) can safely
 * import from here without accidentally bundling the database client (and
 * its DATABASE_URL secret) into the browser.
 */
export function eventHasEnded(dateIso: string, endAt: string | null): boolean {
  const now = new Date();
  if (endAt) return now >= new Date(endAt);
  const endOfDay = new Date(`${dateIso}T23:59:59`);
  return now > endOfDay;
}
