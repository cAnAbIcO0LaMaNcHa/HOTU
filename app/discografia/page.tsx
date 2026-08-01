import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discografía y releases",
  description: "Lanzamientos y discografía de sellos y artistas de la escena electrónica bogotana.",
};

export default function DiscografiaPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ RELEASES
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">DISCOGRAFÍA</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        Próximamente: catálogo de lanzamientos por distrito.
      </p>
    </section>
  );
}
