import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";

export const metadata: Metadata = {
  title: "Empresas aliadas — Únete a nosotros",
  description: "Sumate como marca o colectivo aliado de HOTU. Patrocinios, activaciones y colaboraciones con la escena electrónica de Colombia.",
};

const INTRO =
  "HOTU trabaja con marcas, colectivos y espacios que quieren llegar a la comunidad electrónica de Bogotá y de las principales ciudades de Colombia. Si tu empresa quiere patrocinar un evento, activar en un Ritual Open Air, o simplemente conectar con esta escena, hablemos.";

const CARDS = [
  { title: "PATROCINIOS", desc: "Presencia de marca en eventos HOTU, desde warehouse raves hasta open airs." },
  { title: "ACTIVACIONES", desc: "Espacios de marca dentro de la experiencia del evento." },
  { title: "CONTENIDO", desc: "Colaboraciones en discografía, sets y noticias del portal." },
];

const HABLEMOS = "Escribinos contando de tu marca y qué te gustaría hacer con HOTU.";

export default function AliadosPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ EMPRESAS ALIADAS
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">ÚNETE A NOSOTROS</h1>

      <p className="mt-8 font-mono text-sm leading-relaxed text-muted-foreground">
        <AutoTranslate text={INTRO} />
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {CARDS.map((c) => (
          <div key={c.title} className="border border-border bg-card p-5">
            <h3 className="font-bold">{c.title}</h3>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              <AutoTranslate text={c.desc} />
            </p>
          </div>
        ))}
      </div>

      <div className="mt-14 border-t border-border pt-8">
        <h2 className="text-2xl font-bold">HABLEMOS</h2>
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          <AutoTranslate text={HABLEMOS} />
        </p>
        <a
          href="mailto:aliados@hotu.com.co"
          className="mt-6 inline-flex items-center justify-center px-6 py-3 font-mono text-xs tracking-widest surface-chrome"
        >
          ESCRIBIR A ALIADOS@HOTU.COM.CO
        </a>
      </div>
    </section>
  );
}
