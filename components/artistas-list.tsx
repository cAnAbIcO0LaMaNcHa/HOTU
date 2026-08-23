"use client";

import type { Artist } from "@/lib/db";
import { ArtistBubble } from "@/components/artist-bubble";
import { AutoTranslate } from "@/components/auto-translate";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

export function ArtistasList({ artists }: { artists: Artist[] }) {
  const { selected } = useDistrictFilter();
  const sorted = sortByDistrict(artists, selected);

  return (
    <div className="mt-14 flex flex-wrap justify-center gap-12 sm:justify-start">
      {sorted.map((a) => (
        <ArtistBubble key={a.slug} artist={a} size="lg" />
      ))}
      {sorted.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">
          <AutoTranslate text="Todavía no hay artistas." />
        </p>
      )}
    </div>
  );
}
