"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Play } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import type { Track } from "@/lib/db";

const PAGE_SIZE = 3;
const ROTATE_MS = 20_000;

export function RecentTracks({ tracks }: { tracks: Track[] }) {
  const pageCount = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  const { t } = useLanguage();

  useEffect(() => {
    if (pageCount <= 1) return;
    const id = setInterval(() => {
      setPage((p) => (p + 1) % pageCount);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [pageCount]);

  const start = page * PAGE_SIZE;
  const visible = tracks.slice(start, start + PAGE_SIZE);

  return (
    <section className="py-16">
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary">/ 04 — {t("nueva")}{pageCount > 1 ? ` · ${page + 1}/${pageCount}` : ""}</div>
          <h2 className="mt-2 text-3xl font-bold md:text-4xl">{t("discografia")}</h2>
        </div>
        <Link href="/discografia" className="hidden items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary md:inline-flex">{t("verTodos")} <ChevronRight className="h-3 w-3" /></Link>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {visible.map((tr) => (
          <a key={tr.slug} href={tr.url} className="sheen border-chrome group flex items-center gap-4 p-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:scale-105"><Play className="h-5 w-5 translate-x-0.5" /></div>
            <div className="min-w-0">
              <div className="truncate font-bold">{tr.title}</div>
              <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                {tr.artistSlug ? (<Link href={`/artistas/${tr.artistSlug}`} className="hover:text-primary">{tr.artistName}</Link>) : (tr.artistName)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
