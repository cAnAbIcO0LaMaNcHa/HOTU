"use client";

import Link from "next/link";
import type { Collective, CollectiveMember } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

/**
 * Members now come from artist_collectives rather than the artist_slugs
 * jsonb, passed in already grouped and name-resolved so this component
 * does not need the whole artist catalogue just to print a few names.
 *
 * The residente/toca_con distinction is deliberately NOT shown yet. The
 * migration landed every pre-existing link as 'toca_con' because the jsonb
 * never recorded residency, so surfacing it today would tell every visitor
 * that no collective has a single resident. It goes in once residencies
 * are actually set.
 */
export function ColectivosList({
  collectives: all,
  members,
}: {
  collectives: Collective[];
  members: Record<string, CollectiveMember[]>;
}) {
  const { selected } = useDistrictFilter();
  const sorted = sortByDistrict(all, selected);

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
              const roster = members[c.slug] ?? [];
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
                  {roster.length > 0 && (
                    <div className="mt-4">
                      <div className="font-mono text-[9px] tracking-widest text-primary">
                        <AutoTranslate text="ARTISTAS DE LA MARCA" />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {roster.map((m) => (
                          <Link
                            key={m.artistSlug}
                            href={`/artistas/${m.artistSlug}`}
                            className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary"
                          >
                            <AutoTranslate text={m.artistName} />
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
