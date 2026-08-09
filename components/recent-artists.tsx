import Link from "next/link";
import type { Artist } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ArtistBubble({ artist, size = "md" }: { artist: Artist; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-40 w-40 text-3xl" : size === "sm" ? "h-24 w-24 text-lg" : "h-32 w-32 text-2xl";
  return (
    <Link href={`/artistas/${artist.slug}`} className="group flex flex-col items-center gap-3 text-center">
      <div
        data-district={artist.district}
        className={`sheen border-chrome relative flex ${dims} shrink-0 items-center justify-center overflow-hidden rounded-full transition-transform group-hover:scale-105`}
      >
        {artist.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artist.photo} alt={artist.name} className="h-full w-full object-cover" />
        ) : (
          <span className="font-bold text-chrome">{initials(artist.name)}</span>
        )}
      </div>
      <div>
        <div className="font-bold leading-tight">
          <AutoTranslate text={artist.name} />
        </div>
        <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
          <AutoTranslate text={artist.genre} />
        </div>
      </div>
    </Link>
  );
}
