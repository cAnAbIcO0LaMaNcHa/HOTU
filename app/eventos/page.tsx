import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { DISTRICTS } from "@/lib/districts";
import { AutoTranslate } from "@/components/auto-translate";
import { getAllEvents, formatShortDate, eventHasEnded } from "@/lib/db";
import { AddTicketButton } from "@/components/add-ticket-button";
import { TICKET_PRICES } from "@/lib/commerce-types";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Eventos y raves en Bogotá",
  description: "Agenda de eventos techno y música electrónica en Bogotá, Chía, La Calera y la sabana.",
};

const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

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
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ <AutoTranslate text="AGENDA SABANA" />
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">
        <AutoTranslate text="EVENTOS" />
      </h1>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Fiestas de música electrónica en Bogotá y la sabana. Pagás con QR y el ticket te llega al instante." />
      </p>

      {/* Genre filter — a horizontally-scrolling chip bar. Filled = active,
          outlined = everything else, with a live count so nobody has to
          click into an empty genre to find out it's empty. Still purely
          genre-based on purpose: sorting by date/price isn't the job here. */}
      <div className="-mx-4 mt-8 overflow-x-auto px-4">
        <div className="flex w-max gap-2 pb-2">
          <Link
            href="/eventos"
            className={`whitespace-nowrap px-4 py-2 font-mono text-[10px] tracking-widest transition-colors ${
              !active ? "bg-primary text-background" : "border border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            <AutoTranslate text="TODOS" /> <span className="opacity-70">({events.length})</span>
          </Link>
          {DISTRICTS.map((d) => {
            const count = events.filter((e) => e.district === d.id).length;
            return (
              <Link
                key={d.id}
                href={`/eventos?d=${d.id}`}
                data-district={d.id}
                className={`whitespace-nowrap px-4 py-2 font-mono text-[10px] tracking-widest transition-colors ${
                  active === d.id
                    ? "bg-primary text-background"
                    : "border border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                <AutoTranslate text={d.genre} /> <span className="opacity-70">({count})</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((e) => (
          <article key={e.id} className="group flex flex-col overflow-hidden border border-border bg-card">
            {e.flyerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={e.flyerUrl}
                alt=""
                className="aspect-[3/4] w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div data-district={e.district} className="sheen border-chrome aspect-[3/4] w-full" />
            )}
            <div className="flex flex-1 flex-col p-4">
              <div className="font-mono text-[10px] tracking-widest text-primary">{formatShortDate(e.date)}</div>
              <h3 className="mt-1 text-lg font-bold leading-tight">
                <AutoTranslate text={e.title} />
              </h3>
              <div className="mt-1 flex items-center gap-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" /> {e.city} · {e.venue}
              </div>
              <p className="mt-2 line-clamp-2 font-mono text-[10px] text-muted-foreground">
                <AutoTranslate text={e.lineup} />
              </p>
              <div className="mt-3 font-mono text-sm font-bold">
                <AutoTranslate text="Desde" /> {formatCOP(TICKET_PRICES.normal)}
              </div>
              <AddTicketButton eventId={e.id} eventTitle={e.title} />
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full font-mono text-sm text-muted-foreground">
            <AutoTranslate text="No hay eventos en este género todavía." />
          </p>
        )}
      </div>
    </section>
  );
}
