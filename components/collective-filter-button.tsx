"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, ChevronDown } from "lucide-react";

export type CollectiveOption = { slug: string; name: string };

/**
 * Dropdown filter for /tienda, listing every collective that currently
 * exists in the database. New collectives created in /admin/colectivos
 * show up here automatically the next time the page loads — nothing to
 * update by hand. Closed by default, shows "TODOS".
 */
export function CollectiveFilterButton({
  collectives,
  selected,
  onToggle,
  onClear,
}: {
  collectives: CollectiveOption[];
  selected: string[];
  onToggle: (slug: string) => void;
  onClear: () => void;
}) {
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
        ? (collectives.find((c) => c.slug === selected[0])?.name ?? "TODOS").toUpperCase()
        : `${selected.length} COLECTIVOS`;

  return (
    <div ref={rootRef} className="relative shrink-0">
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
        <div className="absolute left-0 top-full z-30 mt-2 max-h-[70vh] w-72 overflow-y-auto border border-border bg-card shadow-xl">
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className={`flex w-full items-center px-4 py-3 font-mono text-[10px] tracking-widest ${
              selected.length === 0 ? "bg-primary text-background" : "border-b border-border hover:bg-background/60"
            }`}
          >
            TODOS
          </button>
          {collectives.map((c) => (
            <label
              key={c.slug}
              className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-3 font-mono text-[10px] tracking-widest last:border-b-0 hover:bg-background/60"
            >
              <input
                type="checkbox"
                checked={selected.includes(c.slug)}
                onChange={() => onToggle(c.slug)}
                className="h-3.5 w-3.5 accent-primary"
              />
              {c.name}
            </label>
          ))}
          {collectives.length === 0 && (
            <div className="px-4 py-3 font-mono text-[10px] tracking-widest text-muted-foreground">
              Todavía no hay colectivos.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
