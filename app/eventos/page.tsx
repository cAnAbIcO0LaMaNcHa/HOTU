import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { EventosList } from "@/components/eventos-list";
import { getAllEvents, getLineupsByEvent, eventHasEnded } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Eventos y raves en Bogotá",
  description: "Agenda de eventos techno y música electrónica en Bogotá, Chía, La Calera y la sabana.",
};

export default async function EventosPage() {
  /**
   * Events sort themselves by time rather than by an "archived" flag: an
   * event is over once end_at has passed, or once its day has ended when
   * no admin set one. No manual step, and this same page keeps
   * the full history.
   *
   * Both halves are rendered. The page used to drop the past entirely and
   * say "no hay eventos todavía", so a week with nothing announced looked
   * like a broken site even with a full season in the database. Upcoming
   * leads, the past follows as an archive.
   */
  const all = await getAllEvents();
  // Los lineups de TODOS los eventos en una sola consulta, no uno por
  // tarjeta: cada sql del driver HTTP es su propio round-trip.
  const lineups = await getLineupsByEvent(all.map((e) => e.id));
  const events = all.filter((e) => !eventHasEnded(e.date, e.endAt));
  const pastEvents = all
    .filter((e) => eventHasEnded(e.date, e.endAt))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <ListingLayout
      title="EVENTOS"
      description="Fiestas de música electrónica en Bogotá y la sabana. Pagás con QR y el ticket te llega al instante."
      secondaryLabel="CIUDAD"
      secondaryOptions={uniqueSorted(all.map((e) => e.city))}
    >
      {/* Un Map no cruza la frontera servidor/cliente, así que va como
          objeto plano. */}
      <EventosList
        events={events}
        pastEvents={pastEvents}
        lineups={Object.fromEntries(lineups)}
      />
    </ListingLayout>
  );
}
