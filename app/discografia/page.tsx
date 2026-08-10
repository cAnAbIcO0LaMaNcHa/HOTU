import type { Metadata } from "next";
import Link from "next/link";
import { Play } from "lucide-react";
import { DISTRICTS } from "@/lib/districts";
import { AutoTranslate } from "@/components/auto-translate";
import { getAllTracks, formatShortDate } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Discografía y releases",
  description: "Catálogo completo de lanzamientos de la escena electrónica bogotana.",
};

export default async function DiscografiaPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const params = await searchParams;
  const active = params.d;
  const allTracks = await getAllTracks();
  const tracks = active ? allTracks.filter((t) => t.district === active) : allTracks;

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">▶ <AutoTranslate text="RELEASES" /></span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl"><AutoTranslate text="DISCOGRAFÍA" /></h1>

      <div className="mt-8 flex flex-wrap gap-2">
        <Link href="/discografia" className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${!active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><AutoTranslate text="TODOS" /></Link>
        {DISTRICTS.map((d) => (
          <Link key={d.id} href={`/discografia?d=${d.id}`} data-district={d.id} className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${active === d.id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>{d.title} · <AutoTranslate text={d.genre} /></Link>
        ))}
      </div>

      <div className="mt-10 divide-y divide-border border-y border-border">
        {tracks.map((t, i) => (
          <div key={t.slug} className="flex items-center gap-4 py-5">
            <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <a href={t.url} aria-label={`Reproducir ${t.title}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"><Play className="h-4 w-4 translate-x-0.5" /></a>
            <div className="min-w-0 flex-1">
              <a href={t.url} className="block truncate font-bold hover:text-primary"><AutoTranslate text={t.title} /></a>
              <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                {t.artistSlug ? (<Link href={`/artistas/${t.artistSlug}`} className="hover:text-primary"><AutoTranslate text={t.artistName} /></Link>) : (<AutoTranslate text={t.artistName} />)}
              </div>
            </div>
            <span className="hidden shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground sm:block">{formatShortDate(t.releasedAt)}</span>
          </div>
        ))}
        {tracks.length === 0 && (<p className="py-8 font-mono text-sm text-muted-foreground"><AutoTranslate text="No hay tracks en este distrito todavía." /></p>)}
      </div>
    </section>
  );
}
