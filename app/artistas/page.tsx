import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { ArtistasList } from "@/components/artistas-list";
import { getAllArtists, getFilterOptions, getGenreIndex, pickGenreIndex } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá.",
};

export default async function ArtistasPage() {
  const [artists, todos] = await Promise.all([getAllArtists(), getGenreIndex("artist")]);
  // Recortado a los artistas que de verdad se ven: el índice trae también
  // los borradores, que esta página no lista.
  const genreIndex = pickGenreIndex(todos, artists.map((a) => a.slug));
  const { branches, tags } = await getFilterOptions(genreIndex);

  return (
    <ListingLayout
      title="ARTISTAS"
      description="Tocá una burbuja para ver la biografía, sets y tracks de cada artista."
      branches={branches}
      tagOptions={tags}
    >
      <ArtistasList artists={artists} genreIndex={genreIndex} />
    </ListingLayout>
  );
}
