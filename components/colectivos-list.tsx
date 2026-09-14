"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import type { Collective, CollectiveMember } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { useFilteredList, useListingFilters } from "@/components/listing-filters";
import { EmptyResult } from "@/components/listing-empty";

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
  const { active } = useListingFilters();
  // One flat grid, ordered by the district filter's push-to-top. Grouping
  // by sector was dropped in tanda 3 (§1.4): sector is a city label inside
  // a card now, not a heading that splits the page into sections.
  const sorted = useFilteredList(all, {
    // The roster is searchable too: people look for a collective by a DJ
    // they know plays there at least as often as by its own name.
    search: (c) => [
      c.name,
      c.sector,
      c.bio,
      ...(members[c.slug] ?? []).map((m) => m.artistName),
    ],
    secondaryOf: (c) => c.sector,
  });

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
            /**
             * The whole card is the link, not just the title.
             *
             * Done with a stretched overlay rather than by wrapping
             * everything in an <a>, because the roster inside is a row of
             * links to each artist and nesting links is invalid HTML — the
             * browser would break the markup apart and the inner ones
             * would stop working. The overlay sits behind them (z-0 under
             * relative children), so clicking an artist still goes to that
             * artist and clicking anywhere else goes to the collective.
             */
            <article
              key={c.slug}
              className="relative border border-border bg-card p-6 transition-colors hover:border-primary"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xl font-bold">
                  <Link
                    href={`/colectivos/${c.slug}`}
                    className="hover:text-primary after:absolute after:inset-0 after:z-0 after:content-['']"
                  >
                    {c.name}
                  </Link>
                </h3>
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
                        className="relative z-10 border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary"
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
        <EmptyResult active={active} empty="Todavía no hay colectivos." />
      )}
    </div>
  );
}
