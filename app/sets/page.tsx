import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { SetsList } from "@/components/sets-list";
import { getAllSets, getFilterOptions, getGenreIndex, pickGenreIndex } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sets y grabaciones en vivo",
  description: "Sets exclusivos y grabaciones en vivo de la escena techno de Bogotá.",
};

/**
 * El género de un set es el del artista que lo tocó.
 *
 * Un set no declara género propio y no debería: la grabación es de
 * alguien, y ese alguien ya dijo qué hace. Se resuelve por artist_slug,
 * que desde la tanda 2 es un FK real contra artists(slug).
 *
 * El filtro 2 pasa a ser el tag, y ARTISTA queda de SUPLENTE: mientras
 * ningún artista con sets haya declarado género no hay tags que ofrecer,
 * y sin el suplente la página salía con el buscador y nada más. En
 * cuanto los haya, el layout lo reemplaza solo.
 */
export default async function SetsPage() {
  const [sets, todos] = await Promise.all([getAllSets(), getGenreIndex("artist")]);
  const genreIndex = pickGenreIndex(todos, sets.map((s) => s.artistSlug));
  const { branches, tags } = await getFilterOptions(genreIndex);

  return (
    <ListingLayout
      title="SETS"
      description="Grabaciones en vivo de nuestros eventos y sesiones exclusivas."
      branches={branches}
      tagOptions={tags}
      secondaryLabel="ARTISTA"
      secondaryOptions={uniqueSorted(sets.map((s) => s.artistName))}
    >
      <SetsList sets={sets} genreIndex={genreIndex} />
    </ListingLayout>
  );
}
