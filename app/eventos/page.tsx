import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { DISTRICTS } from "@/lib/districts";
import { AutoTranslate } from "@/components/auto-translate";
import { getAllEvents, formatShortDate, eventHasEnded } from "@/lib/db";
import { AddTicketButton } from "@/components/add-ticket-button";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Eventos y raves en Bogotá",
  description: "Agenda de eventos techno y música electrónica en Bogotá, Chía, La Calera y la sabana.",
};

export default async function EventosPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const params = await searchParams;
  const active = params.d;
  // Past events archive themselves automatically — once they're over
  // (using the exact end_at time when an admin set one, or the end of the
  // event's day otherwise) they just stop showing up here. No manual
  // "archived" step needed; see /admin/eventos-pasados for the full history.
  const events = (await getAllEvents()).filter((e) => !eventHasEnded(e.date, e.endAt));
  const filtered = active ? events.filter((e) => e.district === active) : events;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">▶ <AutoTranslate text="AGENDA SABANA" /></span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl"><AutoTranslate text="EVENTOS" /></h1>

      <div className="mt-8 flex flex-wrap gap-2">
        <Link href="/eventos" className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${!active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><AutoTranslate text="TODOS" /></Link>
        {DISTRICTS.map((d) => (
          <Link key={d.id} href={`/eventos?d=${d.id}`} data-district={d.id} className={`border px-3 py-2 font-mono text-[10px] tracking-widest ${active === d.id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>{d.title} · <AutoTranslate text={d.genre} /></Link>
        ))}
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {filtered.map((e) => (
          <article key={e.id} className="border border-border bg-card p-5">
            <div className="font-mono text-xs tracking-widest text-primary">{formatShortDate(e.date)}</div>
            <div className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground"><MapPin className="h-3 w-3" /> {e.city} · {e.venue}</div>
            <h3 className="mt-3 text-xl font-bold"><AutoTranslate text={e.title} /></h3>
            <p className="mt-2 font-mono text-xs text-muted-foreground"><AutoTranslate text={e.lineup} /></p>
            <AddTicketButton eventId={e.id} eventTitle={e.title} />
          </article>
        ))}
        {filtered.length === 0 && (<p className="font-mono text-sm text-muted-foreground"><AutoTranslate text="No hay eventos en este distrito todavía." /></p>)}
      </div>
    </section>
  );
}
