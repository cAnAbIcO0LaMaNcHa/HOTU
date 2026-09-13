"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import type { Collective, CollectiveMember } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

/**
 * Members now come from artist_collectives rather than the artist_slugs
 * jsonb, passed in already grouped and name-resolved so this component
 * does not need the whole artist catalogue just to print a few names.
 *
 * The casa/residente distinction is deliberately NOT shown yet. Every
 * pre-existing link came out of the jsonb, which never recorded which
 * collective was anyone's home, so surfacing it today would tell every
 * visitor that no collective has a single casa. It goes in once the
 * casas are actually assigned.
 */
export function ColectivosList({
  collectives: all,
  members,
}: {
  collectives: Collective[];
  members: Record<string, CollectiveMember[]>;
}) {
  const { selected } = useDistrictFilter();
  // One flat grid, ordered by the district filter's push-to-top. Grouping
  // by sector was dropped in tanda 3 (§1.4): sector is a city label inside
  // a card now, not a heading that splits the page into sections.
  const sorted = sortByDistrict(all, selected);

  return (
    <div className="mt-16">
      <div className="grid gap-6 md:grid-cols-2">
        {sorted.map((c) => {
          const roster = members[c.slug] ?? [];
          const badge =
            c.type === "HOTU"
              ? "border-primary text-primary"
              : "border-muted-foreground text-muted-foreground";
          return (
            <article key={c.slug} className="border border-border bg-card p-6">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xl font-bold">{c.name}</h3>
                <span className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${badge}`}>
                  {c.type === "HOTU" ? "BY HOTU" : "LOCAL"}
                </span>
              </div>

              {/* Sector is a plain origin label now, inside the card. */}
              {c.sector && (
                <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <AutoTranslate text={c.sector} />
                </div>
              )}

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

      {sorted.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">
          <AutoTranslate text="Todavía no hay colectivos." />
        </p>
      )}
    </div>
  );
}
