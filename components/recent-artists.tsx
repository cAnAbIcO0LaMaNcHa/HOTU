import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getRecentArtists } from "@/lib/artists";
import { ArtistBubble } from "@/components/artist-bubble";

export function RecentArtists() {
  const artists = getRecentArtists(6);

  return (
    <section className="mx-auto max-w-7xl px-4 py-20">
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary">/ 03 — NUEVOS EN LA CASA</div>
          <h2 className="mt-2 text-3xl font-bold md:text-4xl">DESCONOCIDOS</h2>
        </div>
        <Link
          href="/artistas"
          className="hidden items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary md:inline-flex"
        >
          VER TODOS <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-10 grid grid-cols-2 justify-items-center gap-x-4 gap-y-10 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
        {artists.map((a) => (
          <ArtistBubble key={a.slug} artist={a} size="sm" />
        ))}
      </div>
    </section>
  );
}
