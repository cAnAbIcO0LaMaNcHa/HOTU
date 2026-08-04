import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sobre nosotros",
  description: "HOTU · House of the Unknown — quiénes somos y por qué existe este universo de música electrónica en Bogotá.",
};

export default function SobreNosotrosPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ LA CASA
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">SOBRE NOSOTROS</h1>

      <p className="mt-8 font-mono text-sm leading-relaxed text-muted-foreground">
        HOTU — House of the Unknown — nació en Bogotá como un hub para la cultura electrónica
        de la sabana: un lugar donde artistas, colectivos y aficionados encuentran el sonido
        que comparten, sin importar en qué distrito de la escena estén.
      </p>

      <p className="mt-6 font-mono text-sm leading-relaxed text-muted-foreground">
        No somos un festival. Somos un universo dividido en 10 distritos, cada uno con su
        propia identidad sonora, desde el T/RAP hasta el Hard Core. Cada distrito filtra
        eventos, artistas, sets y discografía, para que cada quien encuentre su mood.
      </p>

      <h2 className="mt-14 text-2xl font-bold">QUÉ HACEMOS</h2>
      <ul className="mt-4 space-y-2 font-mono text-sm text-muted-foreground">
        <li>— Organizamos y promovemos eventos: raves, warehouse parties y open airs.</li>
        <li>— Conectamos artistas y colectivos de toda Colombia con audiencias nuevas.</li>
        <li>— Publicamos discografía, sets y noticias de la escena.</li>
        <li>— Construimos comunidad alrededor de un sonido, no de una sola fiesta.</li>
      </ul>

      <h2 className="mt-14 text-2xl font-bold">LA CASA ES DE TODOS</h2>
      <p className="mt-4 font-mono text-sm leading-relaxed text-muted-foreground">
        Bogotá, Medellín, Cali, Cartagena, Neiva, Pereira — HOTU crece con cada colectivo
        local que se suma. Si haces parte de la escena y quieres ser parte de la casa,
        escribinos.
      </p>
    </section>
  );
}
