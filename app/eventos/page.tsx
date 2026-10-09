import type { Metadata } from "next";
import { ListingLayout } from "@/components/listing-layout";
import { EventosList } from "@/components/eventos-list";
import { getAllEvents, getLineupsByEvent, getMyArtistSlug, eventHasEnded } from "@/lib/db";
import { uniqueSorted } from "@/lib/listing-options";
import { ventaOnlineHabilitada } from "@/lib/flags";
import { auth } from "@/auth";
import {
  getConvocatoriasAbiertas,
  getLoQueElDjYaHizo,
} from "@/lib/convocatorias-read";

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
  /**
   * ============================================================
   * LAS CONVOCATORIAS, Y QUIÉN LAS VE
   * ============================================================
   *
   * `esDj` es tener perfil de artista, o sea poder postularse. Una convocatoria 'djs' solo
   * se le muestra a quien podría usarla; una 'publica' a cualquiera. Lo elige el colectivo
   * al abrirla, y el default es 'djs' porque es el que no cuenta de más: el distintivo
   * también dice que el lineup no está cerrado.
   *
   * ES UN FILTRO DE PRESENTACIÓN Y NO UN PERMISO. Una 'djs' sigue siendo postulable: el
   * write path no mira visibilidad. Si lo mirara, alguien con el link se postularía a algo
   * que la lista le escondía, y eso sería un agujero en vez de una decisión.
   *
   * SIN SESIÓN NO SE CONSULTA NADA DEL DJ, que es el caso de la mayoría de las visitas: se
   * pasa esDj=false y se saltean las dos consultas de estado personal.
   */
  const session = await auth();
  const email = session?.user?.email ?? null;
  const artistSlug = email ? await getMyArtistSlug(email) : null;
  const convocatorias = await getConvocatoriasAbiertas(artistSlug !== null);
  const yaHizo = artistSlug
    ? await getLoQueElDjYaHizo(artistSlug)
    : { pendientesEn: new Set<number>(), enLineupDe: new Set<number>() };

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
      {/* Un Map y un Set no cruzan la frontera servidor/cliente, así que van como objeto
          plano y como lista. Es lo mismo que ya pasaba con los lineups. */}
      <EventosList
        events={events}
        pastEvents={pastEvents}
        lineups={Object.fromEntries(lineups)}
        ventaOnline={ventaOnlineHabilitada()}
        convocatorias={Object.fromEntries(convocatorias.map((c) => [c.eventId, c]))}
        artistSlug={artistSlug}
        pendientesEn={[...yaHizo.pendientesEn]}
        enLineupDe={[...yaHizo.enLineupDe]}
      />
    </ListingLayout>
  );
}
