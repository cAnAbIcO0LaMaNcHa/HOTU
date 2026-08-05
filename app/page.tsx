import Link from "next/link";
import { Ticket, Play, ChevronRight, MapPin } from "lucide-react";
import { DistrictGrid } from "@/components/district-grid";
import { RecentArtists } from "@/components/recent-artists";
import { RecentTracks } from "@/components/recent-tracks";
import { AutoTranslate } from "@/components/auto-translate";
import { HeroTitle } from "@/components/hero-title";

const events = [
  { date: "14.06.26", city: "BOGOTÁ", venue: "Bodega 38", title: "HOTU PRIME · NOCHE 01", lineup: "Nina Acid · Subsuelo DJs · HOTU Residents" },
  { date: "22.06.26", city: "LA CALERA", venue: "Cerro Verde", title: "HOTU RITUAL OPEN AIR", lineup: "Páramo Club · Monte Negro · HOTU 138" },
  { date: "05.07.26", city: "CHÍA", venue: "Finca Norte", title: "CHÍA UNDERGROUND VOL.12", lineup: "Chía Underground · HOTU Crew" },
];

const news = [
  { tag: "RELEASE", date: "02.05.26", title: "HOTU Records anuncia compilatorio de aniversario", excerpt: "12 tracks inéditos de productores residentes de Bogotá, Chía y La Calera." },
  { tag: "GEAR", date: "29.04.26", title: "Llega a Bogotá el primer lote del Analog Rytm MKIII", excerpt: "La nueva drum machine aterriza en tiendas locales." },
  { tag: "CLUB", date: "27.04.26", title: "Subterráneo reabre con sistema Funktion-One", excerpt: "El club bogotano vuelve con line-up de apertura de 24 horas." },
];

export default function Home() {
  return (
    <>
      {/* HERO */}
      <section className="relative mx-auto mt-8 max-w-7xl overflow-hidden border border-border">
        <div className="flex h-[60vh] min-h-[420px] w-full items-end bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-base)] p-6 md:p-12">
          <div>
            <span className="mb-4 inline-flex w-fit border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
              ▶ <AutoTranslate text="COVER STORY" />
            </span>
            <HeroTitle />
            <p className="mt-6 max-w-xl font-mono text-sm text-muted-foreground md:text-base">
              <AutoTranslate text="La nueva generación de DJs que está redefiniendo el sonido de la capital." />
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/eventos"
                className="inline-flex items-center gap-2 rounded-none px-6 py-3 font-mono text-xs tracking-widest surface-chrome"
              >
                <Ticket className="h-4 w-4" /> <AutoTranslate text="COMPRAR ENTRADAS" />
              </Link>
              <Link
                href="/sets"
                className="inline-flex items-center gap-2 rounded-none border border-foreground px-6 py-3 font-mono text-xs tracking-widest text-foreground hover:bg-foreground hover:text-background"
              >
                <Play className="h-4 w-4" /> <AutoTranslate text="ESCUCHAR AHORA" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <DistrictGrid />

      {/* EVENTS */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <SectionHeading number="01" title="PRÓXIMOS EVENTOS" sub="AGENDA" href="/eventos" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {events.map((e) => (
            <article key={e.title} className="border border-border bg-card p-5 transition-colors hover:border-primary">
              <div className="font-mono text-xs tracking-widest text-primary">{e.date}</div>
              <div className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground">
                <MapPin className="h-3 w-3" /> {e.city} · {e.venue}
              </div>
              <h3 className="mt-3 text-xl font-bold"><AutoTranslate text={e.title} /></h3>
              <p className="mt-2 font-mono text-xs text-muted-foreground">{e.lineup}</p>
              <Link href="/eventos" className="mt-5 inline-flex items-center gap-2 border-b border-primary pb-1 font-mono text-xs tracking-widest text-primary">
                <AutoTranslate text="COMPRAR ENTRADAS" /> <ChevronRight className="h-3 w-3" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* NEWS */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <SectionHeading number="02" title="ÚLTIMAS NOTICIAS" sub="ESTA SEMANA" href="/noticias" />
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {news.map((n) => (
            <article key={n.title}>
              <span className="inline-block bg-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary-foreground">
                {n.tag}
              </span>
              <div className="mt-3 font-mono text-[10px] tracking-widest text-muted-foreground">{n.date}</div>
              <h3 className="mt-2 text-xl font-bold leading-tight"><AutoTranslate text={n.title} /></h3>
              <p className="mt-2 font-mono text-xs text-muted-foreground"><AutoTranslate text={n.excerpt} /></p>
              <Link href="/noticias" className="mt-4 inline-flex items-center gap-2 border-b border-primary pb-1 font-mono text-xs tracking-widest text-primary">
                <AutoTranslate text="LEER MÁS" /> <ChevronRight className="h-3 w-3" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <RecentArtists />

      <RecentTracks />

      {/* NEWSLETTER */}
      <section className="border-y border-border bg-card py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary">/ NEWSLETTER</span>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl"><AutoTranslate text="CONECTA CON TU CASA" /></h2>
          <p className="mt-3 font-mono text-sm text-muted-foreground">
            <AutoTranslate text="Eventos, lanzamientos y sets exclusivos cada viernes en tu inbox." />
          </p>
          <form className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              required
              placeholder="tu@email.com"
              className="flex-1 border border-border bg-background px-4 py-3 font-mono text-sm focus:border-primary focus:outline-none"
            />
            <button type="submit" className="px-6 py-3 font-mono text-xs tracking-widest surface-chrome">
              <AutoTranslate text="SUBSCRIBIR" />
            </button>
          </form>
        </div>
      </section>
    </>
  );
}

function SectionHeading({ number, title, sub, href }: { number: string; title: string; sub: string; href: string }) {
  return (
    <div className="flex items-end justify-between border-b border-border pb-4">
      <div>
        <div className="font-mono text-[10px] tracking-[0.3em] text-primary">/ {number} — <AutoTranslate text={sub} /></div>
        <h2 className="mt-2 text-3xl font-bold md:text-4xl"><AutoTranslate text={title} /></h2>
      </div>
      <Link href={href} className="hidden items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary md:inline-flex">
        <AutoTranslate text="VER TODO" /> <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
