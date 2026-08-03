import type { Metadata } from "next";
import Link from "next/link";
import { Play } from "lucide-react";
import { getAllTracksSorted } from "@/lib/tracks";

export const metadata: Metadata = {
  title: "Discografía y releases",
  description: "Catálogo completo de lanzamientos de artistas y sellos de la escena electrónica bogotana.",
};

export default function DiscografiaPage() {
  const tracks = getAllTracksSorted();

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ RELEASES
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">DISCOGRAFÍA</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        Catálogo completo de HOTU, del más reciente al primero. Este mismo catálogo es el que
        rota cada 20 segundos en la sección "En Rotación" del inicio.
      </p>

      <div className="mt-14 divide-y divide-border border-y border-border">
        {tracks.map((t, i) => (
          <a
            key={t.slug}
            href={t.url}
            className="group flex items-center gap-4 py-5 transition-colors hover:text-primary"
          >
            <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:scale-105">
              <Play className="h-4 w-4 translate-x-0.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{t.title}</div>
              <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                {t.artistSlug ? (
                  <Link
                    href={`/artistas/${t.artistSlug}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-primary"
                  >
                    {t.artistName}
                  </Link>
                ) : (
                  t.artistName
                )}
              </div>
            </div>
            <span className="hidden shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground sm:block">
              {new Date(t.releasedAt).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "2-digit" })}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
