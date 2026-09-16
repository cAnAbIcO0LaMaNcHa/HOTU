"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import type { DjSet, GenreIndexEntry } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { useFilteredList, useListingFilters } from "@/components/listing-filters";
import { EmptyResult } from "@/components/listing-empty";

export function SetsList({
  sets: allSets,
  genreIndex,
}: {
  sets: DjSet[];
  /** Género POR SLUG DE ARTISTA, no de set: el set lo hereda. */
  genreIndex: Record<string, GenreIndexEntry>;
}) {
  const { active } = useListingFilters();
  const sets = useFilteredList(allSets, {
    // Title and artist. Somebody hunting a set knows one or the other.
    search: (s) => [s.title, s.artistName],
    genreOf: (s) => (s.artistSlug ? genreIndex[s.artistSlug] : undefined),
    // El suplente del tag. El layout renderiza uno de los dos, nunca los
    // dos, así que acá pueden convivir sin pisarse.
    secondaryOf: (s) => s.artistName,
  });

  return (
    <div className="mt-10 grid gap-4 md:grid-cols-2">
      {sets.map((s) => (
        <div key={s.slug} className="sheen border-chrome flex items-center gap-4 p-4">
          <a
            href={s.url}
            aria-label={`Reproducir ${s.title}`}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
          >
            <Play className="h-4 w-4 translate-x-0.5" />
          </a>
          <div className="min-w-0 flex-1">
            <a href={s.url} className="block truncate font-bold hover:text-primary">
              <AutoTranslate text={s.title} />
            </a>
            <div className="mt-1 truncate font-mono text-[10px] tracking-widest text-muted-foreground">
              {s.artistSlug ? (
                <Link href={`/artistas/${s.artistSlug}`} className="hover:text-primary">
                  <AutoTranslate text={s.artistName} />
                </Link>
              ) : (
                <AutoTranslate text={s.artistName} />
              )}{" "}
              · {s.duration}
            </div>
          </div>
        </div>
      ))}
      {sets.length === 0 && (
        <EmptyResult active={active} empty="Todavía no hay sets." />
      )}
    </div>
  );
}
