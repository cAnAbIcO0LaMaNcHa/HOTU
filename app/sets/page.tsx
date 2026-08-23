import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { SetsList } from "@/components/sets-list";
import { DistrictFilterButton } from "@/components/district-filter-button";
import { getAllSets } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sets y grabaciones en vivo",
  description: "Sets exclusivos y grabaciones en vivo de la escena techno de Bogotá.",
};

export default async function SetsPage() {
  const sets = await getAllSets();

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl font-bold leading-[0.9] md:text-7xl">
          <AutoTranslate text="SETS" />
        </h1>
        <DistrictFilterButton />
      </div>

      <SetsList sets={sets} />
    </section>
  );
}
