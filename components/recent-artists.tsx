"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ArtistBubble } from "@/components/artist-bubble";
import { useLanguage } from "@/lib/i18n";
import type { Artist } from "@/lib/db";

const PAGE_SIZE = 6;
const ROTATE_MS = 20_000;

export function RecentArtists({ artists }: { artists: Artist[] }) {
  // La guarda vive acá y no en quien lo monta: un carrusel vacío con su
  // encabezado es la misma sección vacía, la monte quien la monte.
  const vacio = artists.length === 0;
  const pageCount = Math.max(1, Math.ceil(artists.length / PAGE_SIZE));
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
  const visible = artists.slice(start, start + PAGE_SIZE);

  // Vacío no se renderiza: ni encabezado, ni flechas, ni una fila
  // en blanco. Es la regla del proyecto, la misma que siguen el press
  // kit y la grilla de géneros.
  if (vacio) return null;

  return (
    <section className="py-16">
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary">/ 03 — {t("nuevos")}{pageCount > 1 ? ` · ${page + 1}/${pageCount}` : ""}</div>
          <h2 className="mt-2 text-3xl font-bold md:text-4xl">{t("artistas")}</h2>
        </div>
        <Link href="/artistas" className="hidden items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary md:inline-flex">{t("verTodos")} <ChevronRight className="h-3 w-3" /></Link>
      </div>
      <div className="mt-10 grid grid-cols-2 justify-items-center gap-x-4 gap-y-10 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
        {visible.map((a) => (
          <ArtistBubble key={a.slug} artist={a} size="sm" />
        ))}
      </div>
    </section>
  );
}
