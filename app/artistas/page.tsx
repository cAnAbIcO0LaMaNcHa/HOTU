import type { Metadata } from "next";
import Link from "next/link";
import { ARTISTS } from "@/lib/artists";
import { DISTRICTS } from "@/lib/districts";
import { ArtistBubble } from "@/components/artist-bubble";

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá. Bio, sets y tracks de cada artista.",
};

export default async function ArtistasPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const params = await searchParams;
  const active = params.d;
  const filtered = active ? ARTISTS.filter((a) => a.district === active) : ARTISTS;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ VOICES OF BOGOTÁ
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">ARTISTAS</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        Filtrá por distrito o tocá una burbuja para ver la biografía, sets y tracks de cada artista.
      </p>

      <div className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/artistas"
          className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${!active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
        >
          TODOS
        </Link>
        {DISTRICTS.map((d) => (
          <Link
            key={d.id}
            href={`/artistas?d=${d.id}`}
            data-district={d.id}
            className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${active === d.id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            {d.title} · {d.genre}
          </Link>
        ))}
      </div>

      <div className="mt-14 flex flex-wrap justify-center gap-12 sm:justify-start">
        {filtered.map((a) => (
          <ArtistBubble key={a.slug} artist={a} size="lg" />
        ))}
        {filtered.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground">No hay artistas en este distrito todavía.</p>
        )}
      </div>
    </section>
  );
}
