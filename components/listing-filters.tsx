"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { DistrictId } from "@/lib/districts";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

/**
 * The search box and the secondary filter of a listing page.
 *
 * Kept in context rather than passed down because the controls live in the
 * page's filter bar while the filtering happens inside the grid component,
 * and those two are siblings. The district/genre filter is deliberately
 * NOT here — it is global and already has its own provider, since that
 * choice follows the user from page to page and these two do not.
 *
 * Scoped per page on purpose: "el buscador busca sobre el contenido de la
 * sección donde está", so landing on a new listing starts clean rather
 * than carrying somebody's old search across.
 */
type Ctx = {
  query: string;
  setQuery: (q: string) => void;
  /** The chosen value of the page's secondary filter, or "" for all. */
  secondary: string;
  setSecondary: (v: string) => void;
  /** True when either control is narrowing the list. */
  active: boolean;
};

const ListingFilterContext = createContext<Ctx | null>(null);

export function ListingFilterProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [secondary, setSecondary] = useState("");

  const value = useMemo(
    () => ({
      query,
      setQuery,
      secondary,
      setSecondary,
      active: query.trim() !== "" || secondary !== "",
    }),
    [query, secondary]
  );

  return (
    <ListingFilterContext.Provider value={value}>{children}</ListingFilterContext.Provider>
  );
}

export function useListingFilters(): Ctx {
  const ctx = useContext(ListingFilterContext);
  // A list rendered outside a listing page still has to work, so this
  // degrades to "nothing is filtering" instead of throwing.
  return (
    ctx ?? {
      query: "",
      setQuery: () => {},
      secondary: "",
      setSecondary: () => {},
      active: false,
    }
  );
}

/**
 * Folds accents and case so "bogota" finds "Bogotá" and "chia" finds
 * "Chía". Without this the search is unusable in Spanish: nobody types
 * the accent, and the content is full of them.
 *
 * NFD splits an accented letter into its base plus a combining mark, and
 * the range below is exactly the combining-marks block, which is then
 * dropped.
 */
const COMBINING = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g"
);

export function normalize(text: string): string {
  return text.normalize("NFD").replace(COMBINING, "").toLowerCase().trim();
}

/**
 * Applies the search box to a list. Each item contributes the strings the
 * caller says are searchable, joined into one haystack.
 *
 * Every word in the query has to appear somewhere, in any order, so
 * "camila techno" matches an artist named Camila filed under techno. An
 * empty query returns the list untouched rather than an empty result.
 */
export function applySearch<T>(items: T[], query: string, fields: (item: T) => (string | null | undefined)[]): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const hay = normalize(fields(item).filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Everything a listing grid needs, in one call: the secondary filter, then
 * the search, then the shared genre ordering.
 *
 * The order matters. The first two NARROW the list — the user asked for a
 * subset and gets it. The genre filter only REORDERS, pushing matches to
 * the top without hiding anything, which is the rule the district system
 * has always followed. Sorting first and filtering after would throw away
 * that ordering work.
 */
export function useFilteredList<T extends { district: DistrictId }>(
  items: T[],
  opts: {
    /** The strings the search box looks at for each item. */
    search: (item: T) => (string | null | undefined)[];
    /** The value the page's second filter compares against. */
    secondaryOf?: (item: T) => string | null | undefined;
  }
): T[] {
  const { query, secondary } = useListingFilters();
  const { selected } = useDistrictFilter();

  return useMemo(() => {
    let out = items;
    if (secondary && opts.secondaryOf) {
      const want = normalize(secondary);
      out = out.filter((i) => normalize(String(opts.secondaryOf!(i) ?? "")) === want);
    }
    out = applySearch(out, query, opts.search);
    return sortByDistrict(out, selected);
    // opts is rebuilt inline by every caller, so depending on it would
    // recompute on each render and defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, secondary, selected]);
}
