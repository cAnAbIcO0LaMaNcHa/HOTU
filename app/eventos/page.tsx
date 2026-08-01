import type { Metadata } from "next";
import Link from "next/link";
import { DISTRICTS } from "@/lib/districts";
import { MapPin } from "lucide-react";

export const metadata: Metadata = {
  title: "Eventos y raves en Bogotá",
  description: "Agenda de eventos techno y música electrónica en Bogotá, Chía, La Calera y la sabana.",
};

const events = [
  { date: "14.06.26", city: "BOGOTÁ", venue: "Bodega 38", title: "HOTU PRIME · NOCHE 01", district: "D07" },
  { date: "22.06.26", city: "LA CALERA", venue: "Cerro Verde", title: "HOTU RITUAL OPEN AIR", district: "D04" },
  { date: "05.07.26", city: "CHÍA", venue: "Finca Norte", title: "CHÍA UNDERGROUND VOL.12", district: "D01" },
];

export default function EventosPage({ searchParams }: { searchParams: { d?: string } }) {
  const active = searchParams.d;
  const filtered = active ? events.filter((e) => e.district === active) : events;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ AGENDA SABANA
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">EVENTOS</h1>

      {/* District selector */}
      <div className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/eventos"
          className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${!active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
        >
          TODOS
        </Link>
        {DISTRICTS.map((d) => (
          <Link
            key={d.id}
            href={`/eventos?d=${d.id}`}
            data-district={d.id}
            className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${active === d.id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            {d.title} · {d.genre}
          </Link>
        ))}
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {filtered.map((e) => (
          <article key={e.title} className="border border-border bg-card p-5">
            <div className="font-mono text-xs tracking-widest text-primary">{e.date}</div>
            <div className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground">
              <MapPin className="h-3 w-3" /> {e.city} · {e.venue}
            </div>
            <h3 className="mt-3 text-xl font-bold">{e.title}</h3>
          </article>
        ))}
        {filtered.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground">No hay eventos en este distrito todavía.</p>
        )}
      </div>
    </section>
  );
}
