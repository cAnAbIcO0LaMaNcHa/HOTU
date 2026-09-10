"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EpkSection } from "./epk-editable-section";
import { formatShortDate } from "@/lib/date-utils";
import type { ArtistGig } from "@/lib/db";

/**
 * EVENTS — a horizontal carousel of flyers, each linking to its event.
 *
 * A gig sourced from a HOTU lineup links to the event page; a declared gig
 * played elsewhere has no page to link to, so it renders as a plain card
 * and is labelled, because an organiser reading the press kit should be
 * able to tell which numbers HOTU can vouch for.
 */
export function EpkEvents({
  gigs,
  canEdit,
  currentYear,
}: {
  gigs: ArtistGig[];
  canEdit: boolean;
  /** Passed in from the server so the summary cannot differ between the
   *  server render and hydration if the year turns over mid-request. */
  currentYear: number;
}) {
  const thisYear = gigs.filter((g) => g.gigDate.startsWith(String(currentYear))).length;

  return (
    <EpkSection
      title="EVENTS"
      isEmpty={gigs.length === 0}
      canEdit={canEdit}
      hint="Todavía no hay toques acá. Los de fiestas publicadas en HOTU entran solos desde el lineup; si tocaste afuera, agregalo a mano y queda marcado como declarado."
    >
      <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
        {gigs.map((gig) => {
          const title = gig.eventTitle ?? gig.externalName ?? "Sin título";

          const card = (
            <>
              <span
                data-district={gig.district ?? "D00"}
                className="sheen border-chrome flex aspect-[3/4] w-full items-center justify-center overflow-hidden transition-colors group-hover:border-primary"
              >
                {gig.flyerUrl ? (
                  <img
                    src={gig.flyerUrl}
                    alt={`Flyer de ${title}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <CalendarDays className="h-10 w-10 text-chrome" />
                )}
              </span>
              <span className="mt-2 block truncate text-sm font-bold">{title}</span>
              <span className="block truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                {formatShortDate(gig.gigDate)}
                {gig.venue ? ` · ${gig.venue}` : ""}
              </span>
              {gig.source === "declarado" && (
                <span className="mt-1 inline-block border border-border px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground">
                  DECLARADO
                </span>
              )}
            </>
          );

          return gig.eventId ? (
            <Link
              key={gig.id}
              href={`/eventos#evento-${gig.eventId}`}
              className="group w-44 shrink-0"
            >
              {card}
            </Link>
          ) : (
            <div key={gig.id} className="group w-44 shrink-0">
              {card}
            </div>
          );
        })}
      </div>

      <p className="mt-4 font-mono text-[11px] tracking-[0.2em] text-muted-foreground">
        {gigs.length} {gigs.length === 1 ? "EVENTO" : "EVENTOS"}
        {thisYear > 0 && `, ${thisYear} EN ${currentYear}`}
      </p>
    </EpkSection>
  );
}
