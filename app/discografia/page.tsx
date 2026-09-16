import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { DiscografiaList } from "@/components/discografia-list";
import { getAllTracks, getFilterOptions, getGenreIndex, pickGenreIndex } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Discografía y releases",
  description: "Catálogo completo de lanzamientos de la escena electrónica bogotana.",
};

/**
 * Mismo criterio que /sets: el género del track es el de quien lo hizo, y
 * SELLO queda de suplente del tag hasta que haya tags que ofrecer.
 */
export default async function DiscografiaPage() {
  const [tracks, todos] = await Promise.all([getAllTracks(), getGenreIndex("artist")]);
  const genreIndex = pickGenreIndex(todos, tracks.map((t) => t.artistSlug));
  const { branches, tags } = await getFilterOptions(genreIndex);

  return (
    <ListingLayout
      title="DISCOGRAFÍA"
      description="Catálogo completo de releases de la escena. Dale play y descubrí lo nuevo."
      branches={branches}
      tagOptions={tags}
      secondaryLabel="SELLO"
      secondaryOptions={uniqueSorted(tracks.map((t) => t.label))}
    >
      <DiscografiaList tracks={tracks} genreIndex={genreIndex} />
    </ListingLayout>
  );
}
