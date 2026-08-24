import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { ColectivosList } from "@/components/colectivos-list";
import { DistrictFilterButton } from "@/components/district-filter-button";
import { getAllCollectives, getAllArtists } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Colectivos electrónicos",
  description: "Colectivos y crews que mueven la cultura electrónica underground en Bogotá y la sabana.",
};

export default async function ColectivosPage() {
  const [collectives, artists] = await Promise.all([getAllCollectives(), getAllArtists()]);

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <h1 className="text-5xl font-bold leading-[0.9] md:text-7xl">COLECTIVOS</h1>
      <div className="mt-6">
        <DistrictFilterButton />
      </div>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Organizados por sector. BY HOTU son colectivos propios de la marca — LOCAL son crews independientes." />
      </p>

      <ColectivosList collectives={collectives} artists={artists} />
    </section>
  );
}
