"use client";

import { MapPin } from "lucide-react";
import type { EventItem } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { AddTicketButton } from "@/components/add-ticket-button";
import { TICKET_PRICES } from "@/lib/commerce-types";
import { formatShortDate } from "@/lib/date-utils";
import { useFilteredList, useListingFilters } from "@/components/listing-filters";
import { EmptyResult } from "@/components/listing-empty";

const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

/**
 * The agenda, in two parts.
 *
 * Upcoming events are the page's job. Past ones used to vanish entirely,
 * which meant that on a quiet week the page read "No hay eventos todavía"
 * while the database held a season's worth of them — the site looked empty
 * and broken rather than simply between parties.
 *
 * So the past is shown too, below and clearly separated, with no ticket
 * button: a finished event is history, not stock. The wording of the empty
 * state is now honest as well — "todavía" claimed nothing had ever
 * happened, which was never what the filter meant.
 */
export function EventosList({
  events,
  pastEvents = [],
}: {
  events: EventItem[];
  /** Already over, newest first. Shown as an archive, never as buyable. */
  pastEvents?: EventItem[];
}) {
  const { active } = useListingFilters();
  // Search and filters apply to both halves: looking for a party you went
  // to last winter has to reach the archive, not just what is on sale.
  const searchFields = (e: EventItem) => [e.title, e.venue, e.city, e.lineup];
  const sorted = useFilteredList(events, { search: searchFields, secondaryOf: (e) => e.city });
  const past = useFilteredList(pastEvents, { search: searchFields, secondaryOf: (e) => e.city });

  return (
    <>
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
        {sorted.length === 0 && (
          <EmptyResult
            active={active}
            empty={
              past.length > 0
                ? "No hay eventos anunciados por ahora. Abajo están los que ya pasaron."
                : "No hay eventos anunciados por ahora."
            }
          />
        )}
      </div>

      {past.length > 0 && (
        <div className="mt-16">
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
            <AutoTranslate text="YA PASARON" />
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {past.map((e) => (
              <EventCard key={e.id} event={e} past />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function EventCard({ event: e, past = false }: { event: EventItem; past?: boolean }) {
  return (
    <article
      className={`group flex flex-col overflow-hidden border border-border bg-card ${
        past ? "opacity-70 transition-opacity hover:opacity-100" : ""
      }`}
    >
      {e.flyerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={e.flyerUrl}
          alt=""
          className="aspect-[3/4] w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="sheen border-chrome aspect-[3/4] w-full" />
      )}
      <div className="flex flex-1 flex-col p-4">
        <div
          className={`font-mono text-[10px] tracking-widest ${
            past ? "text-muted-foreground" : "text-primary"
          }`}
        >
          {formatShortDate(e.date)}
        </div>
        <h3 className="mt-1 text-lg font-bold leading-tight">
          <AutoTranslate text={e.title} />
        </h3>
        <div className="mt-1 flex items-center gap-1 font-mono text-[9px] tracking-widest text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" /> {e.city} · {e.venue}
        </div>
        <p className="mt-2 line-clamp-2 font-mono text-[10px] text-muted-foreground">
          <AutoTranslate text={e.lineup} />
        </p>

        {past ? (
          // No price and no button: the party already happened.
          <div className="mt-3 font-mono text-[10px] tracking-widest text-muted-foreground">
            <AutoTranslate text="FINALIZADO" />
          </div>
        ) : (
          <>
            <div className="mt-3 font-mono text-sm font-bold">
              <AutoTranslate text="Desde" /> {formatCOP(TICKET_PRICES.normal)}
            </div>
            <AddTicketButton eventId={e.id} eventTitle={e.title} />
          </>
        )}
      </div>
    </article>
  );
}
