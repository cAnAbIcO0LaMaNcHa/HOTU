import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { ColectivosList } from "@/components/colectivos-list";
import { getAllCollectives, getCollectiveMembers } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Colectivos electrónicos",
  description: "Colectivos y crews que mueven la cultura electrónica underground en Bogotá y la sabana.",
};

export default async function ColectivosPage() {
  const [collectives, members] = await Promise.all([getAllCollectives(), getCollectiveMembers()]);

  return (
    <ListingLayout
      title="COLECTIVOS"
      description="BY HOTU son colectivos propios de la marca — LOCAL son crews independientes."
      secondaryLabel="SECTOR"
      secondaryOptions={uniqueSorted(collectives.map((c) => c.sector))}
    >
      {/* A Map cannot cross the server/client boundary, so it is handed
          over as a plain object. */}
      <ColectivosList collectives={collectives} members={Object.fromEntries(members)} />
    </ListingLayout>
  );
}
