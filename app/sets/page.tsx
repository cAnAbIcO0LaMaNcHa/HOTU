import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { SetsList } from "@/components/sets-list";
import { getAllSets } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sets y grabaciones en vivo",
  description: "Sets exclusivos y grabaciones en vivo de la escena techno de Bogotá.",
};

export default async function SetsPage() {
  const sets = await getAllSets();

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ <AutoTranslate text="SONIDO EN ROTACIÓN" />
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">
        <AutoTranslate text="SETS" />
      </h1>

      <SetsList sets={sets} />
    </section>
  );
}
