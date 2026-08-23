"use client";

import type { NewsItem } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { formatShortDate } from "@/lib/date-utils";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

export function NoticiasList({ news: allNews }: { news: NewsItem[] }) {
  const { selected } = useDistrictFilter();
  const news = sortByDistrict(allNews, selected);

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
        <p className="font-mono text-sm text-muted-foreground">
          <AutoTranslate text="Todavía no hay noticias." />
        </p>
      )}
    </div>
  );
}
