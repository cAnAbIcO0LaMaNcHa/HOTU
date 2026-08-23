"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, ChevronDown } from "lucide-react";
import { DISTRICTS, type DistrictId } from "@/lib/districts";

/**
 * Closed-by-default dropdown that replaces the old row of district chips.
 * Reads/writes the "d" query param as a comma-separated list, so more than
 * one genre can be checked at once (e.g. "D01,D03" = House + Tech House).
 * Shared across every page that filters by district: eventos, artistas,
 * discografia, sets.
 */
export function GenreFilterMenu({
  counts,
  total,
}: {
  counts: Partial<Record<DistrictId, number>>;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const raw = searchParams.get("d");
  const selected = raw ? (raw.split(",") as DistrictId[]) : [];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function updateSelection(next: DistrictId[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length === 0) params.delete("d");
    else params.set("d", next.join(","));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function toggleDistrict(id: DistrictId) {
    updateSelection(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const label =
    selected.length === 0
      ? `TODOS (${total})`
      : selected.length === 1
        ? (DISTRICTS.find((d) => d.id === selected[0])?.genre ?? "TODOS").toUpperCase()
        : `${selected.length} GÉNEROS`;

  return (
    <div ref={rootRef} className="relative mt-8 inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 border border-border px-4 py-2 font-mono text-[10px] tracking-widest hover:border-primary"
      >
        <Menu className="h-3 w-3" />
        {label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 max-h-[70vh] w-80 overflow-y-auto border border-border bg-card shadow-xl">
          <button
            type="button"
            onClick={() => {
              updateSelection([]);
              setOpen(false);
            }}
            className={`flex w-full items-center justify-between border-b border-border px-4 py-3 font-mono text-[10px] tracking-widest ${
              selected.length === 0 ? "bg-primary text-background" : "hover:bg-background/60"
            }`}
          >
            TODOS <span className="opacity-70">({total})</span>
          </button>
          {DISTRICTS.map((d) => (
            <label
              key={d.id}
              className="flex cursor-pointer items-center justify-between gap-2 border-b border-border px-4 py-3 font-mono text-[10px] tracking-widest last:border-b-0 hover:bg-background/60"
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={() => toggleDistrict(d.id)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {d.title} · {d.genre}
              </span>
              <span className="opacity-70">({counts[d.id] ?? 0})</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
