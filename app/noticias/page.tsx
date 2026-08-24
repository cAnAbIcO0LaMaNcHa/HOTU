import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { NoticiasList } from "@/components/noticias-list";
import { DistrictFilterButton } from "@/components/district-filter-button";
import { getAllNews } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Noticias techno y electrónica",
  description: "Últimas noticias de la escena techno y electrónica en Bogotá: releases, gear, clubes y más.",
};

export default async function NoticiasPage() {
  const news = await getAllNews();

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <h1 className="text-5xl font-bold leading-[0.9] md:text-7xl">
        <AutoTranslate text="NOTICIAS" />
      </h1>
      <div className="mt-6">
        <DistrictFilterButton />
      </div>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Lo último de la escena: releases, gear, clubes y movimientos en Bogotá." />
      </p>

      <NoticiasList news={news} />
    </section>
  );
}
