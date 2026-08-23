import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { DiscografiaList } from "@/components/discografia-list";
import { getAllTracks } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Discografía y releases",
  description: "Catálogo completo de lanzamientos de la escena electrónica bogotana.",
};

export default async function DiscografiaPage() {
  const tracks = await getAllTracks();

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ <AutoTranslate text="RELEASES" />
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">
        <AutoTranslate text="DISCOGRAFÍA" />
      </h1>

      <DiscografiaList tracks={tracks} />
    </section>
  );
}
