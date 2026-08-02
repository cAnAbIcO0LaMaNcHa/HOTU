import type { Metadata } from "next";
import { ARTISTS } from "@/lib/artists";
import { ArtistBubble } from "@/components/artist-bubble";

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá. Bio, sets y tracks de cada artista.",
};

export default function ArtistasPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ VOICES OF BOGOTÁ
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">ARTISTAS</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        Tocá una burbuja para ver la biografía, sets y tracks de cada artista.
      </p>

      <div className="mt-14 flex flex-wrap justify-center gap-12 sm:justify-start">
        {ARTISTS.map((a) => (
          <ArtistBubble key={a.slug} artist={a} size="lg" />
        ))}
      </div>
    </section>
  );
}
