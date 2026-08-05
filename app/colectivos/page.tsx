import type { Metadata } from "next";
import Link from "next/link";
import { getCollectivesBySector } from "@/lib/collectives";
import { getArtistBySlug } from "@/lib/artists";
import { AutoTranslate } from "@/components/auto-translate";

export const metadata: Metadata = {
  title: "Colectivos electrónicos",
  description: "Colectivos y crews que mueven la cultura electrónica underground en Bogotá y la sabana, organizados por sector.",
};

export default function ColectivosPage() {
  const bySector = getCollectivesBySector();

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ <AutoTranslate text="COMUNIDAD" />
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">COLECTIVOS</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Organizados por sector. BY HOTU son colectivos propios de la marca — LOCAL son crews independientes de la escena actual." />
      </p>

      <div className="mt-16 space-y-20">
        {Array.from(bySector.entries()).map(([sector, collectives]) => (
          <div key={sector}>
            <h2 className="border-b border-border pb-4 text-2xl font-bold tracking-tight">
              / <AutoTranslate text={sector.toUpperCase()} />
            </h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {collectives.map((c) => {
                const artists = c.artistSlugs
                  .map((s) => getArtistBySlug(s))
                  .filter((a): a is NonNullable<typeof a> => Boolean(a));
                return (
                  <article key={c.slug} className="border border-border bg-card p-6">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-bold">{c.name}</h3>
                      <span
                        className={`font-mono text-[9px] tracking-widest px-2 py-1 border ${
                          c.type === "HOTU"
                            ? "border-primary text-primary"
                            : "border-muted-foreground text-muted-foreground"
                        }`}
                      >
                        {c.type === "HOTU" ? "BY HOTU" : "LOCAL"}
                      </span>
                    </div>
                    <p className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground">
                      <AutoTranslate text={c.bio} />
                    </p>
                    {artists.length > 0 && (
                      <div className="mt-4">
                        <div className="font-mono text-[9px] tracking-widest text-primary">
                          <AutoTranslate text="ARTISTAS DE LA MARCA" />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {artists.map((a) => (
                            <Link
                              key={a.slug}
                              href={`/artistas/${a.slug}`}
                              className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary"
                            >
                              <AutoTranslate text={a.name} />
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
