import type { Metadata } from "next";
import Link from "next/link";
import { Play } from "lucide-react";
import { DISTRICTS } from "@/lib/districts";
import { AutoTranslate } from "@/components/auto-translate";
import { getAllSets } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sets y grabaciones en vivo",
  description: "Sets exclusivos y grabaciones en vivo de la escena techno de Bogotá, filtrables por distrito.",
};

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const params = await searchParams;
  const active = params.d;
  const allSets = await getAllSets();
  const sets = active ? allSets.filter((s) => s.district === active) : allSets;

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ <AutoTranslate text="SONIDO EN ROTACIÓN" />
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl"><AutoTranslate text="SETS" /></h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Grabaciones en vivo de HOTU, filtrables por distrito." />
      </p>

      <div className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/sets"
          className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${!active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
        >
          <AutoTranslate text="TODOS" />
        </Link>
        {DISTRICTS.map((d) => (
          <Link
            key={d.id}
            href={`/sets?d=${d.id}`}
            data-district={d.id}
            className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${active === d.id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            {d.title} · <AutoTranslate text={d.genre} />
          </Link>
        ))}
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {sets.map((s) => (
          <div key={s.slug} data-district={s.district} className="sheen border-chrome flex items-center gap-4 p-4">
            
              href={s.url}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
              aria-label={`Reproducir ${s.title}`}
            >
              <Play className="h-4 w-4 translate-x-0.5" />
            </a>
            <div className="min-w-0 flex-1">
              <a href={s.url} className="block truncate font-bold hover:text-primary">
                <AutoTranslate text={s.title} />
              </a>
              <div className="mt-1 truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                {s.artistSlug ? (
                  <Link href={`/artistas/${s.artistSlug}`} className="hover:text-primary">
                    <AutoTranslate text={s.artistName} />
                  </Link>
                ) : (
                  <AutoTranslate text={s.artistName} />
                )}{" "}
                · {s.duration}
              </div>
            </div>
          </div>
        ))}
        {sets.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground"><AutoTranslate text="No hay sets en este distrito todavía." /></p>
        )}
      </div>
    </section>
  );
}
