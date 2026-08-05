import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Play } from "lucide-react";
import { getAllTracksSorted } from "@/lib/tracks";
import { useLanguage } from "@/lib/i18n";

const PAGE_SIZE = 3;
const ROTATE_MS = 20_000;

/**
 * CATALOG ROTATION: shows PAGE_SIZE tracks at a time from the FULL published
 * catalog (not just the newest). Every ROTATE_MS it advances to the next
 * page. Because it steps sequentially through the whole array and wraps
 * back to 0 only after the last page, no track repeats until the entire
 * catalog has been shown once — then it starts over from the top.
 */
export function RecentTracks() {
  const allTracks = getAllTracksSorted();
  const pageCount = Math.max(1, Math.ceil(allTracks.length / PAGE_SIZE));
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
  const visible = allTracks.slice(start, start + PAGE_SIZE);

  return (
    <section className="mx-auto max-w-7xl px-4 py-20">
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary">
            / 04 — {t("nueva")}{pageCount > 1 ? ` · ${page + 1}/${pageCount}` : ""}
          </div>
          <h2 className="mt-2 text-3xl font-bold md:text-4xl">{t("discografia")}</h2>
        </div>
        <Link
          href="/discografia"
          className="hidden items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary md:inline-flex"
        >
          {t("verTodos")} <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {visible.map((t2) => (
          <a
            key={t2.slug}
            href={t2.url}
            className="sheen border-chrome group flex items-center gap-4 p-4"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:scale-105">
              <Play className="h-5 w-5 translate-x-0.5" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-bold">{t2.title}</div>
              <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                {t2.artistSlug ? (
                  <Link href={`/artistas/${t2.artistSlug}`} className="hover:text-primary">
                    {t2.artistName}
                  </Link>
                ) : (
                  t2.artistName
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
