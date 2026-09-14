import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { SetsList } from "@/components/sets-list";
import { getAllSets } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sets y grabaciones en vivo",
  description: "Sets exclusivos y grabaciones en vivo de la escena techno de Bogotá.",
};

export default async function SetsPage() {
  const sets = await getAllSets();

  return (
    <ListingLayout
      title="SETS"
      description="Grabaciones en vivo de nuestros eventos y sesiones exclusivas."
      secondaryLabel="ARTISTA"
      secondaryOptions={uniqueSorted(sets.map((s) => s.artistName))}
    >
      <SetsList sets={sets} />
    </ListingLayout>
  );
}
