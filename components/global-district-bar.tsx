"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, ChevronDown } from "lucide-react";
import { DISTRICTS } from "@/lib/districts";
import { useDistrictFilter } from "@/components/district-filter-context";

/**
 * Sits in its own thin strip directly under the main header, on every
 * page, so the selection is always visible and always the same control —
 * no more per-page filter UI. Closed by default, shows "TODOS".
 */
export function GlobalDistrictBar() {
  const { selected, toggle, clear } = useDistrictFilter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const label =
    selected.length === 0
      ? "TODOS"
      : selected.length === 1
        ? (DISTRICTS.find((d) => d.id === selected[0])?.genre ?? "TODOS").toUpperCase()
        : `${selected.length} GÉNEROS`;

  return (
    <div className="border-b border-border bg-background/95">
      <div ref={rootRef} className="relative mx-auto max-w-7xl px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 border border-border px-4 py-1.5 font-mono text-[10px] tracking-widest hover:border-primary"
        >
          <Menu className="h-3 w-3" />
          {label}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute left-4 top-full z-30 mt-2 max-h-[70vh] w-80 overflow-y-auto border border-border bg-card shadow-xl">
            <button
              type="button"
              onClick={() => {
                clear();
                setOpen(false);
              }}
              className={`flex w-full items-center px-4 py-3 font-mono text-[10px] tracking-widest ${
                selected.length === 0 ? "bg-primary text-background" : "border-b border-border hover:bg-background/60"
              }`}
            >
              TODOS
            </button>
            {DISTRICTS.map((d) => (
              <label
                key={d.id}
                className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-3 font-mono text-[10px] tracking-widest last:border-b-0 hover:bg-background/60"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={() => toggle(d.id)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {d.title} · {d.genre}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
