"use client";

import Link from "next/link";
import type { Collective, Artist } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

export function ColectivosList({ collectives: all, artists }: { collectives: Collective[]; artists: Artist[] }) {
  const { selected } = useDistrictFilter();
  const sorted = sortByDistrict(all, selected);
  const artistBySlug = new Map(artists.map((a) => [a.slug, a]));

  // Group by sector, keeping the district-sorted order within each group.
  const bySector = new Map<string, Collective[]>();
  for (const c of sorted) {
    if (!bySector.has(c.sector)) bySector.set(c.sector, []);
    bySector.get(c.sector)!.push(c);
  }

  return (
    <div className="mt-16 space-y-20">
      {Array.from(bySector.entries()).map(([sector, group]) => (
        <div key={sector}>
          <h2 className="border-b border-border pb-4 text-2xl font-bold tracking-tight">
            / <AutoTranslate text={sector.toUpperCase()} />
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {group.map((c) => {
              const members = c.artistSlugs
                .map((s) => artistBySlug.get(s))
                .filter((a): a is Artist => Boolean(a));
              const badge = c.type === "HOTU" ? "border-primary text-primary" : "border-muted-foreground text-muted-foreground";
              return (
                <article key={c.slug} className="border border-border bg-card p-6">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold">{c.name}</h3>
                    <span className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${badge}`}>
                      {c.type === "HOTU" ? "BY HOTU" : "LOCAL"}
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    <AutoTranslate text={c.bio} />
                  </p>
                  {members.length > 0 && (
                    <div className="mt-4">
                      <div className="font-mono text-[9px] tracking-widest text-primary">
                        <AutoTranslate text="ARTISTAS DE LA MARCA" />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {members.map((a) => (
                          <Link
                            key={a.slug}
                            href={`/artistas/${a.slug}`}
                            className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary"
                          >
                            <AutoTranslate text={a.name} />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      ))}
      {sorted.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">
          <AutoTranslate text="Todavía no hay colectivos." />
        </p>
      )}
    </div>
  );
}
