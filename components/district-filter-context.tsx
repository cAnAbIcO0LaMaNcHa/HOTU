"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { DistrictId } from "@/lib/districts";

const STORAGE_KEY = "hotu-district-filter";

type Ctx = {
  selected: DistrictId[];
  toggle: (id: DistrictId) => void;
  clear: () => void;
};

const DistrictFilterContext = createContext<Ctx | null>(null);

/**
 * Holds the globally-selected districts, persisted in localStorage so the
 * choice survives page navigation and reloads. Nothing here ever hides
 * content — pages use `sortByDistrict` to push matches to the top instead.
 */
export function DistrictFilterProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<DistrictId[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSelected(JSON.parse(raw));
    } catch {
      // ignore malformed/blocked storage
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  }, [selected, hydrated]);

  function toggle(id: DistrictId) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function clear() {
    setSelected([]);
  }

  return (
    <DistrictFilterContext.Provider value={{ selected, toggle, clear }}>
      {children}
    </DistrictFilterContext.Provider>
  );
}

export function useDistrictFilter() {
  const ctx = useContext(DistrictFilterContext);
  if (!ctx) throw new Error("useDistrictFilter must be used within DistrictFilterProvider");
  return ctx;
}

/** Pushes items whose district is in `selected` to the front, keeping
 * everyone else right after — nothing ever disappears. */
export function sortByDistrict<T extends { district: DistrictId }>(
  items: T[],
  selected: DistrictId[]
): T[] {
  if (selected.length === 0) return items;
  const matching = items.filter((i) => selected.includes(i.district));
  const rest = items.filter((i) => !selected.includes(i.district));
  return [...matching, ...rest];
}
