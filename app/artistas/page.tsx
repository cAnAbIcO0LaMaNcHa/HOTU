import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Artistas de la escena Bogotá",
  description: "DJs y productores residentes de la escena techno y electrónica de Bogotá.",
};

export default function ArtistasPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ VOICES OF BOGOTÁ
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">ARTISTAS</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        Próximamente: perfiles de DJs y productores por distrito.
      </p>
    </section>
  );
}
