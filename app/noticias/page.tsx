import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";

export const metadata: Metadata = {
  title: "Noticias techno y electrónica",
  description: "Últimas noticias de la escena techno y electrónica en Bogotá: releases, gear, clubes y más.",
};

const news = [
  { tag: "RELEASE", date: "02.05.26", title: "HOTU Records anuncia compilatorio de aniversario", excerpt: "12 tracks inéditos de productores residentes de Bogotá, Chía y La Calera." },
  { tag: "GEAR", date: "29.04.26", title: "Llega a Bogotá el primer lote del Analog Rytm MKIII", excerpt: "La nueva drum machine aterriza en tiendas locales para los productores de la sabana." },
  { tag: "CLUB", date: "27.04.26", title: "Subterráneo reabre con sistema Funktion-One", excerpt: "El club bogotano vuelve con un line-up de apertura HOTU de 24 horas continuas." },
];

export default function NoticiasPage() {
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
          <article key={n.title}>
            <span className="inline-block bg-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary-foreground">
              <AutoTranslate text={n.tag} />
            </span>
            <div className="mt-3 font-mono text-[10px] tracking-widest text-muted-foreground">{n.date}</div>
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
