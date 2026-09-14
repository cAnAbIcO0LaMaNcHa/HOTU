import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { EventosList } from "@/components/eventos-list";
import { DistrictFilterButton } from "@/components/district-filter-button";
import { getAllEvents, eventHasEnded } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Eventos y raves en Bogotá",
  description: "Agenda de eventos techno y música electrónica en Bogotá, Chía, La Calera y la sabana.",
};

export default async function EventosPage() {
  /**
   * Events sort themselves by time rather than by an "archived" flag: an
   * event is over once end_at has passed, or once its day has ended when
   * no admin set one. No manual step, and /admin/eventos-pasados still has
   * the full history.
   *
   * Both halves are rendered now. The page used to drop the past entirely
   * and say "no hay eventos todavía", so a week with nothing announced
   * looked like a broken site even with a full season in the database.
   * Upcoming leads, the past follows as an archive.
   */
  const all = await getAllEvents();
  const events = all.filter((e) => !eventHasEnded(e.date, e.endAt));
  const pastEvents = all
    .filter((e) => eventHasEnded(e.date, e.endAt))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <h1 className="text-5xl font-bold leading-[0.9] md:text-7xl">
        <AutoTranslate text="EVENTOS" />
      </h1>
      <div className="mt-6">
        <DistrictFilterButton />
      </div>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Fiestas de música electrónica en Bogotá y la sabana. Pagás con QR y el ticket te llega al instante." />
      </p>

      <EventosList events={events} pastEvents={pastEvents} />
    </section>
  );
}
