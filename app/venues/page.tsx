import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { VenuesList } from "@/components/venues-list";
import { getAllVenues, getCollectiveMembers } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Venues y clubes",
  description: "Clubes, bodegas y espacios donde suena la electrónica en Bogotá y la sabana.",
};

/**
 * /venues — sección propia, con su propia navegación (§5).
 *
 * Comparte tabla con los colectivos y no comparte NADA de la superficie:
 * es otra ruta, otro listado y otro press kit. Que por dentro sean la
 * misma tabla es una decisión de adentro y no se filtra acá.
 *
 * getAllVenues y getCollectiveMembers("venue") son los dos lectores
 * filtrados; sin ellos este listado mostraría también los colectivos.
 */
export default async function VenuesPage() {
  const [venues, members] = await Promise.all([
    getAllVenues(),
    getCollectiveMembers("venue"),
  ]);

  return (
    <ListingLayout
      title="VENUES"
      description="Clubes, bodegas y espacios donde suena la electrónica. Tocá uno para ver su ficha y escribirle."
      secondaryLabel="SECTOR"
      secondaryOptions={uniqueSorted(venues.map((v) => v.sector))}
    >
      {/* Un Map no cruza la frontera server/client, así que va como objeto. */}
      <VenuesList venues={venues} members={Object.fromEntries(members)} />
    </ListingLayout>
  );
}
