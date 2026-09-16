"use client";

import type { Artist, GenreIndexEntry } from "@/lib/db";
import { ArtistBubble } from "@/components/artist-bubble";
import { useFilteredList, useListingFilters } from "@/components/listing-filters";
import { EmptyResult } from "@/components/listing-empty";

export function ArtistasList({
  artists,
  genreIndex,
}: {
  artists: Artist[];
  genreIndex: Record<string, GenreIndexEntry>;
}) {
  const { active } = useListingFilters();
  const sorted = useFilteredList(artists, {
    // Name, genre, city and origin: what somebody would actually type
    // looking for a DJ. The bio is left out — it turns every broad word
    // into a match and the results stop meaning anything.
    search: (a) => [a.name, a.genre, a.city, a.origin],
    genreOf: (a) => genreIndex[a.slug],
  });

  return (
    <div className="mt-14 flex flex-wrap justify-center gap-12 sm:justify-start">
      {sorted.map((a) => (
        <ArtistBubble key={a.slug} artist={a} size="lg" />
      ))}
      {sorted.length === 0 && (
        <EmptyResult active={active} empty="Todavía no hay artistas." />
      )}
    </div>
  );
}
