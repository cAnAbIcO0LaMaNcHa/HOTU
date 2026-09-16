"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import type { GenreIndexEntry, Track } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { formatShortDate } from "@/lib/date-utils";
import { useFilteredList, useListingFilters } from "@/components/listing-filters";
import { EmptyResult } from "@/components/listing-empty";

export function DiscografiaList({
  tracks: allTracks,
  genreIndex,
}: {
  tracks: Track[];
  /** Género POR SLUG DE ARTISTA, no de track: el track lo hereda. */
  genreIndex: Record<string, GenreIndexEntry>;
}) {
  const { active } = useListingFilters();
  const tracks = useFilteredList(allTracks, {
    // Title, artist and imprint: the three things printed on a release.
    // El sello sigue siendo buscable aunque ya no sea el filtro 2.
    search: (t) => [t.title, t.artistName, t.label],
    genreOf: (t) => (t.artistSlug ? genreIndex[t.artistSlug] : undefined),
  });

  return (
    <div className="mt-10 divide-y divide-border border-y border-border">
      {tracks.map((t, i) => (
        <div key={t.slug} className="flex items-center gap-4 py-5">
          <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
          <a
            href={t.url}
            aria-label={`Reproducir ${t.title}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
          >
            <Play className="h-4 w-4 translate-x-0.5" />
          </a>
          <div className="min-w-0 flex-1">
            <a href={t.url} className="block truncate font-bold hover:text-primary">
              <AutoTranslate text={t.title} />
            </a>
            <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
              {t.artistSlug ? (
                <Link href={`/artistas/${t.artistSlug}`} className="hover:text-primary">
                  <AutoTranslate text={t.artistName} />
                </Link>
              ) : (
                <AutoTranslate text={t.artistName} />
              )}
            </div>
          </div>
          <span className="hidden shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground sm:block">
            {formatShortDate(t.releasedAt)}
          </span>
        </div>
      ))}
      {tracks.length === 0 && (
        <div className="py-8">
          <EmptyResult active={active} empty="Todavía no hay tracks." />
        </div>
      )}
    </div>
  );
}
