"use client";

import { MapPin } from "lucide-react";
import type { EventItem } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { AddTicketButton } from "@/components/add-ticket-button";
import { TICKET_PRICES } from "@/lib/commerce-types";
import { formatShortDate } from "@/lib/db";
import { useDistrictFilter, sortByDistrict } from "@/components/district-filter-context";

const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export function EventosList({ events }: { events: EventItem[] }) {
  const { selected } = useDistrictFilter();
  const sorted = sortByDistrict(events, selected);

  return (
    <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {sorted.map((e) => (
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
      {sorted.length === 0 && (
        <p className="col-span-full font-mono text-sm text-muted-foreground">
          <AutoTranslate text="No hay eventos todavía." />
        </p>
      )}
    </div>
  );
}
