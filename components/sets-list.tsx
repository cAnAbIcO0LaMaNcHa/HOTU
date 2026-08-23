"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import type { DjSet } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

export function SetsList({ sets: allSets }: { sets: DjSet[] }) {
  const { selected } = useDistrictFilter();
  const sets = sortByDistrict(allSets, selected);

  return (
    <div className="mt-10 grid gap-4 md:grid-cols-2">
      {sets.map((s) => (
        <div key={s.slug} data-district={s.district} className="sheen border-chrome flex items-center gap-4 p-4">
          <a
            href={s.url}
            aria-label={`Reproducir ${s.title}`}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
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
        <p className="font-mono text-sm text-muted-foreground">
          <AutoTranslate text="Todavía no hay sets." />
        </p>
      )}
    </div>
  );
}
