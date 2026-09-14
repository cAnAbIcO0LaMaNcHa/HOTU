import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { ArtistasList } from "@/components/artistas-list";
import { getAllArtists } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá.",
};

export default async function ArtistasPage() {
  const artists = await getAllArtists();

  return (
    <ListingLayout
      title="ARTISTAS"
      description="Tocá una burbuja para ver la biografía, sets y tracks de cada artista."
      secondaryLabel="GÉNERO"
      secondaryOptions={uniqueSorted(artists.map((a) => a.genre))}
    >
      <ArtistasList artists={artists} />
    </ListingLayout>
  );
}
