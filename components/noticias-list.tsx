"use client";

import type { NewsItem } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { formatShortDate } from "@/lib/date-utils";
import { useFilteredList, useListingFilters } from "@/components/listing-filters";
import { EmptyResult } from "@/components/listing-empty";

export function NoticiasList({ news: allNews }: { news: NewsItem[] }) {
  const { active } = useListingFilters();
  const news = useFilteredList(allNews, {
    // Tag, headline and excerpt — the whole of a news item that is
    // visible on this page, so what you can read is what you can find.
    search: (n) => [n.tag, n.title, n.excerpt],
    secondaryOf: (n) => n.tag,
  });

  return (
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
      {news.length === 0 && (
        <EmptyResult active={active} empty="Todavía no hay noticias." />
      )}
    </div>
  );
}
