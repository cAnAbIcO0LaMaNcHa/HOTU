import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { getAllNews, formatShortDate } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Noticias techno y electrónica",
  description: "Últimas noticias de la escena techno y electrónica en Bogotá: releases, gear, clubes y más.",
};

export default async function NoticiasPage() {
  const news = await getAllNews();

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ <AutoTranslate text="DESDE LA PISTA" />
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">
        <AutoTranslate text="NOTICIAS" />
      </h1>

      <div className="mt-14 grid gap-8 md:grid-cols-3">
        {news.map((n) => (
          <article key={n.id}>
            <span className="inline-block bg-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary-foreground">
              <AutoTranslate text={n.tag} />
            </span>
            <div className="mt-3 font-mono text-[10px] tracking-widest text-muted-foreground">{formatShortDate(n.date)}</div>
            <h3 className="mt-2 text-xl font-bold leading-tight">
              <AutoTranslate text={n.title} />
            </h3>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              <AutoTranslate text={n.excerpt} />
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
