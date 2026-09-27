import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { uniqueSorted } from "@/lib/listing-options";
import { ColectivosList } from "@/components/colectivos-list";
import {
  getAllCollectives,
  getVinculos,
  getFilterOptions,
  getGenreIndex,
  pickGenreIndex,
} from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Colectivos electrónicos",
  description:
    "Colectivos y crews que mueven la cultura electrónica underground en Bogotá y la sabana.",
};

export default async function ColectivosPage() {
  const [collectives, vinculos, todos] = await Promise.all([
    getAllCollectives(),
    getVinculos(),
    getGenreIndex("collective"),
  ]);
  const genreIndex = pickGenreIndex(todos, collectives.map((c) => c.slug));
  const { branches, tags } = await getFilterOptions(genreIndex);

  return (
    <ListingLayout
      title="COLECTIVOS"
      description="BY HOTU son colectivos propios de la marca — LOCAL son crews independientes."
      branches={branches}
      tagOptions={tags}
      // SECTOR queda de suplente: hoy ningún colectivo declaró género,
      // y sin esto la página se quedaba sin un solo filtro. En cuanto
      // haya tags, el layout lo reemplaza solo.
      secondaryLabel="SECTOR"
      secondaryOptions={uniqueSorted(collectives.map((c) => c.sector))}
    >
      {/* A Map cannot cross the server/client boundary, so it is handed
          over as a plain object. */}
      <ColectivosList
        collectives={collectives}
        vinculos={Object.fromEntries(vinculos)}
        genreIndex={genreIndex}
      />
    </ListingLayout>
  );
}
