import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { DiscografiaList } from "@/components/discografia-list";
import { DistrictFilterButton } from "@/components/district-filter-button";
import { getAllTracks } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Discografía y releases",
  description: "Catálogo completo de lanzamientos de la escena electrónica bogotana.",
};

export default async function DiscografiaPage() {
  const tracks = await getAllTracks();

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl font-bold leading-[0.9] md:text-7xl">
          <AutoTranslate text="DISCOGRAFÍA" />
        </h1>
        <DistrictFilterButton />
      </div>

      <DiscografiaList tracks={tracks} />
    </section>
  );
}
