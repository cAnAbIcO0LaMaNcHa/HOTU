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
