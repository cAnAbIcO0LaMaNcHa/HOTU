import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { NoticiasList } from "@/components/noticias-list";
import { getAllNews } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Noticias techno y electrónica",
  description: "Últimas noticias de la escena techno y electrónica en Bogotá: releases, gear, clubes y más.",
};

export default async function NoticiasPage() {
  const news = await getAllNews();

  return (
    <ListingLayout
      title="NOTICIAS"
      description="Lo último de la escena: releases, gear, clubes y movimientos en Bogotá."
      secondaryLabel="ETIQUETA"
      secondaryOptions={uniqueSorted(news.map((n) => n.tag))}
    >
      <NoticiasList news={news} />
    </ListingLayout>
  );
}

