import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { DiscografiaList } from "@/components/discografia-list";
import { getAllTracks } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Discografía y releases",
  description: "Catálogo completo de lanzamientos de la escena electrónica bogotana.",
};

export default async function DiscografiaPage() {
  const tracks = await getAllTracks();

  return (
    <ListingLayout
      title="DISCOGRAFÍA"
      description="Catálogo completo de releases de la escena. Dale play y descubrí lo nuevo."
      secondaryLabel="SELLO"
      secondaryOptions={uniqueSorted(tracks.map((t) => t.label))}
    >
      <DiscografiaList tracks={tracks} />
    </ListingLayout>
  );
}
