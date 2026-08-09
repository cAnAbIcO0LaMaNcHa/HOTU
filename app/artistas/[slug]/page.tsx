import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Play, MapPin } from "lucide-react";
import { AutoTranslate } from "@/components/auto-translate";
import { getArtistBySlug } from "@/lib/db";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) return {};
  return {
    title: `${artist.name} — Bio, sets y tracks`,
    description: artist.bio,
  };
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) notFound();

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <div className="flex flex-col items-center gap-6 text-center md:flex-row md:items-start md:text-left">
        <div
          data-district={artist.district}
          className="sheen border-chrome flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-full"
        >
          {artist.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artist.photo} alt={artist.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-4xl font-bold text-chrome">{initials(artist.name)}</span>
          )}
        </div>
        <div>
          <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
            {artist.genre}
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-[0.95] md:text-6xl">{artist.name}</h1>
          <div className="mt-3 flex items-center justify-center gap-2 font-mono text-xs tracking-widest text-muted-foreground md:justify-start">
            <MapPin className="h-3 w-3" /> {artist.city}
          </div>
        </div>
      </div>

      <p className="mt-10 max-w-3xl font-mono text-sm leading-relaxed text-muted-foreground">
        <AutoTranslate text={artist.bio} />
      </p>

      {artist.sets.length > 0 && (
        <div className="mt-14">
          <h2 className="text-2xl font-bold">SETS</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {artist.sets.map((s) => (
              <a key={s.title} href={s.url} className="sheen border-chrome flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Play className="h-4 w-4 translate-x-0.5" />
                </div>
                <div>
                  <div className="font-bold">{s.title}</div>
                  {s.duration && (
                    <div className="font-mono text-[10px] tracking-widest text-muted-foreground">{s.duration}</div>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {artist.topTracks.length > 0 && (
        <div className="mt-14">
          <h2 className="text-2xl font-bold">TRACKS DESTACADOS</h2>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {artist.topTracks.map((t, i) => (
              <a key={t.title} href={t.url} className="flex items-center gap-4 py-4 transition-colors hover:text-primary">
                <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-bold">{t.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
