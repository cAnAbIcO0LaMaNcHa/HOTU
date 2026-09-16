import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { ArtistasList } from "@/components/artistas-list";
import { getAllArtists, getFilterOptions, getGenreIndex, pickGenreIndex } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá.",
};

export default async function ArtistasPage({
  searchParams,
}: {
  /** ?g=TEC, el link de la grilla de la home. En Next 15 es una Promise. */
  searchParams: Promise<{ g?: string }>;
}) {
  const { g } = await searchParams;
  const [artists, todos] = await Promise.all([getAllArtists(), getGenreIndex("artist")]);
  // Recortado a los artistas que de verdad se ven: el índice trae también
  // los borradores, que esta página no lista.
  const genreIndex = pickGenreIndex(todos, artists.map((a) => a.slug));
  const { branches, tags } = await getFilterOptions(genreIndex);

  // Un ?g= que no corresponda a ninguna rama presente se ignora: el
  // <select> quedaría en un valor que no está entre sus <option>, y el
  // navegador mostraría el primero mientras el filtro esconde todo.
  const initialBranch = branches.some((b) => b.code === g) ? g : undefined;

  return (
    <ListingLayout
      title="ARTISTAS"
      initialBranch={initialBranch}
      description="Tocá una burbuja para ver la biografía, sets y tracks de cada artista."
      branches={branches}
      tagOptions={tags}
      // El género viejo de texto libre, de suplente. Hoy en producción
      // nadie declaró taxonomía, así que sin esto la página salía con el
      // buscador y nada más: menos de lo que tenía. En cuanto haya tags,
      // el layout lo reemplaza solo.
      secondaryLabel="GÉNERO"
      secondaryOptions={uniqueSorted(artists.map((a) => a.genre))}
    >
      <ArtistasList artists={artists} genreIndex={genreIndex} />
    </ListingLayout>
  );
}
