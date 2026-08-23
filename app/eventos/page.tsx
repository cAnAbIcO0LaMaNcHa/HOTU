import type { Metadata } from "next";
import { AutoTranslate } from "@/components/auto-translate";
import { EventosList } from "@/components/eventos-list";
import { getAllEvents, eventHasEnded } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Eventos y raves en Bogotá",
  description: "Agenda de eventos techno y música electrónica en Bogotá, Chía, La Calera y la sabana.",
};

export default async function EventosPage() {
  // Past events archive themselves automatically — once they're over
  // (using the exact end_at time when an admin set one, or the end of the
  // event's day otherwise) they just stop showing up here. No manual
  // "archived" step needed; see /admin/eventos-pasados for the full history.
  const events = (await getAllEvents()).filter((e) => !eventHasEnded(e.date, e.endAt));

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

      <EventosList events={events} />
    </section>
  );
}
