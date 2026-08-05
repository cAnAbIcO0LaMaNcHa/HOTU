"use client";

import Link from "next/link";
import { DISTRICTS } from "@/lib/districts";
import { AutoTranslate } from "@/components/auto-translate";

export function DistrictGrid() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20">
      <span className="font-mono text-[10px] tracking-[0.3em] text-primary">
        / <AutoTranslate text="EL MAPA · 10 DISTRITOS" />
      </span>
      <h2 className="mt-4 text-4xl font-bold text-white md:text-5xl">
        <AutoTranslate text="ENCUENTRA TU DISTRITO" />
      </h2>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Cada distrito es una identidad sonora. Elige el tuyo y filtra eventos, artistas, sets y releases por el mood que compartes." />
      </p>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {DISTRICTS.map((d) => (
          <Link
            key={d.id}
            href={`/eventos?d=${d.id}`}
            data-district={d.id}
            className="sheen border-chrome flex min-h-[110px] flex-col justify-between p-4"
          >
            <span className="font-mono text-[10px] tracking-[0.3em] text-white">
              <AutoTranslate text={d.genre} />
            </span>
            <span className="mt-3 block text-lg font-bold leading-tight text-chrome">
              <AutoTranslate text={d.title} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
