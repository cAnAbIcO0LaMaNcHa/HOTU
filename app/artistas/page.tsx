import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { ArtistasList } from "@/components/artistas-list";
import { getAllArtists } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá.",
};

export default async function ArtistasPage() {
  const artists = await getAllArtists();

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ <AutoTranslate text="VOICES OF BOGOTÁ" />
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">
        <AutoTranslate text="ARTISTAS" />
      </h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Tocá una burbuja para ver la biografía, sets y tracks de cada artista." />
      </p>

      <ArtistasList artists={artists} />
    </section>
  );
}
