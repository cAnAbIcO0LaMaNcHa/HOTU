import type { Metadata } from "next";
import { DISTRICTS, type DistrictId } from "@/lib/districts";
import { ArtistBubble } from "@/components/artist-bubble";
import { AutoTranslate } from "@/components/auto-translate";
import { GenreFilterMenu } from "@/components/genre-filter-menu";
import { getAllArtists } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá.",
};

export default async function ArtistasPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const params = await searchParams;
  const activeList = params.d ? (params.d.split(",") as DistrictId[]) : [];
  const artists = await getAllArtists();
  const filtered = activeList.length > 0 ? artists.filter((a) => activeList.includes(a.district)) : artists;
  const counts = Object.fromEntries(
    DISTRICTS.map((d) => [d.id, artists.filter((a) => a.district === d.id).length])
  ) as Partial<Record<DistrictId, number>>;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">▶ <AutoTranslate text="VOICES OF BOGOTÁ" /></span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl"><AutoTranslate text="ARTISTAS" /></h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground"><AutoTranslate text="Filtrá por distrito o tocá una burbuja para ver la biografía, sets y tracks de cada artista." /></p>

      <GenreFilterMenu counts={counts} total={artists.length} />

      <div className="mt-14 flex flex-wrap justify-center gap-12 sm:justify-start">
        {filtered.map((a) => (<ArtistBubble key={a.slug} artist={a} size="lg" />))}
        {filtered.length === 0 && (<p className="font-mono text-sm text-muted-foreground"><AutoTranslate text="No hay artistas en este distrito todavía." /></p>)}
      </div>
    </section>
  );
}
