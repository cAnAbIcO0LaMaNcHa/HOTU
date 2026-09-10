import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Play } from "lucide-react";
import { auth } from "@/auth";
import { EpkHeader } from "@/components/epk-header";
import { EpkAbout } from "@/components/epk-about";
import { canEditArtist } from "@/lib/artists-write";
import { getArtistBySlug } from "@/lib/db";

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) return {};
  return { title: `${artist.name} — Bio, sets y tracks`, description: artist.bio };
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) notFound();

  // Same check the API route runs before accepting a write. Hiding the edit
  // controls is presentation; the route is what actually protects the data.
  const session = await auth();
  const canEdit = await canEditArtist(slug, session?.user?.email);

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <EpkHeader artist={artist} canEdit={canEdit} />

      <EpkAbout artist={artist} canEdit={canEdit} />

      {artist.sets.length > 0 && (
        <div className="mt-14">
          <h2 className="text-2xl font-bold">SETS</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {artist.sets.map((s) => (
              <a key={s.title} href={s.url} className="sheen border-chrome flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Play className="h-4 w-4 translate-x-0.5" /></div>
                <div>
                  <div className="font-bold">{s.title}</div>
                  {s.duration && (<div className="font-mono text-[10px] tracking-widest text-muted-foreground">{s.duration}</div>)}
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
