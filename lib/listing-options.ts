/**
 * Builds the option list for a listing page's second filter.
 *
 * Only values that actually occur in that page's rows are offered, so the
 * control can never present a choice that returns nothing. Blanks are
 * dropped and the order is Spanish-aware, so Ñ and accents land where a
 * reader expects rather than where their code points fall.
 *
 * Pure — no database, no React. Safe to import from anywhere.
 */
export function uniqueSorted(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") seen.add(v.trim());
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "es"));
}
