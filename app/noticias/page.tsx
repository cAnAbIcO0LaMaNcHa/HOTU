import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Noticias techno y electrónica",
  description: "Últimas noticias de la escena techno y electrónica en Bogotá: releases, gear, clubes y más.",
};

export default function NoticiasPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ DESDE LA PISTA
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">NOTICIAS</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        Próximamente: releases, gear, aperturas de clubes y todo lo que mueve la escena.
      </p>
    </section>
  );
}
