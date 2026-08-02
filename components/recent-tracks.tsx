import Link from "next/link";
import { ChevronRight, Play } from "lucide-react";
import { getRecentTracks } from "@/lib/tracks";

export function RecentTracks() {
  const tracks = getRecentTracks(3);

  return (
    <section className="mx-auto max-w-7xl px-4 py-20">
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary">/ 04 — ESTA SEMANA</div>
          <h2 className="mt-2 text-3xl font-bold md:text-4xl">DISCOGRAFÍA</h2>
        </div>
        <Link
          href="/discografia"
          className="hidden items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary md:inline-flex"
        >
          VER TODO <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {tracks.map((t) => (
          <a
            key={t.slug}
            href={t.url}
            className="sheen border-chrome group flex items-center gap-4 p-4"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:scale-105">
              <Play className="h-5 w-5 translate-x-0.5" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-bold">{t.title}</div>
              <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                {t.artistSlug ? (
                  <Link href={`/artistas/${t.artistSlug}`} className="hover:text-primary">
                    {t.artistName}
                  </Link>
                ) : (
                  t.artistName
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
