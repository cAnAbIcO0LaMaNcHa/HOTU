import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";

export const metadata: Metadata = {
  title: "Sobre nosotros",
  description: "HOTU · House of the Unknown — quiénes somos y por qué existe este universo de música electrónica en Bogotá.",
};

const PARAGRAPHS = [
  "HOTU — House of the Unknown — nació en Bogotá como un hub para la cultura electrónica de la sabana: un lugar donde artistas, colectivos y aficionados encuentran el sonido que comparten, sin importar en qué distrito de la escena estén.",
  "No somos un festival. Somos un universo dividido en 10 distritos, cada uno con su propia identidad sonora, desde el T/RAP hasta el Hard Core. Cada distrito filtra eventos, artistas, sets y discografía, para que cada quien encuentre su mood.",
];

const BULLETS = [
  "Organizamos y promovemos eventos: raves, warehouse parties y open airs.",
  "Conectamos artistas y colectivos de toda Colombia con audiencias nuevas.",
  "Publicamos discografía, sets y noticias de la escena.",
  "Construimos comunidad alrededor de un sonido, no de una sola fiesta.",
];

const CLOSING =
  "Bogotá, Medellín, Cali, Cartagena, Neiva, Pereira — HOTU crece con cada colectivo local que se suma. Si haces parte de la escena y quieres ser parte de la casa, escribinos.";

export default function SobreNosotrosPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ LA CASA
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">SOBRE NOSOTROS</h1>

      {PARAGRAPHS.map((p, i) => (
        <p key={i} className="mt-8 font-mono text-sm leading-relaxed text-muted-foreground">
          <AutoTranslate text={p} />
        </p>
      ))}

      <h2 className="mt-14 text-2xl font-bold">QUÉ HACEMOS</h2>
      <ul className="mt-4 space-y-2 font-mono text-sm text-muted-foreground">
        {BULLETS.map((b, i) => (
          <li key={i}>
            — <AutoTranslate text={b} />
          </li>
        ))}
      </ul>

      <h2 className="mt-14 text-2xl font-bold">LA CASA ES DE TODOS</h2>
      <p className="mt-4 font-mono text-sm leading-relaxed text-muted-foreground">
        <AutoTranslate text={CLOSING} />
      </p>
    </section>
  );
}
