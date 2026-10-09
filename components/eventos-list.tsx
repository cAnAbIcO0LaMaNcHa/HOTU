"use client";

import { MapPin } from "lucide-react";
import type { EventItem, LineupEntry } from "@/lib/db";
import type { ConvocatoriaAbierta } from "@/lib/convocatorias-read";
import { PostularseAConvocatoria } from "./postularse-a-convocatoria";
import { AutoTranslate } from "@/components/auto-translate";
import { EventLineup } from "@/components/event-lineup";
import { AddTicketButton } from "@/components/add-ticket-button";
import { duracionEnPalabras, formatShortDate, horaEnBogota } from "@/lib/date-utils";
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
  lineups = {},
  ventaOnline = false,
  convocatorias = {},
  artistSlug = null,
  pendientesEn = [],
  enLineupDe = [],
}: {
  events: EventItem[];
  /** Already over, newest first. Shown as an archive, never as buyable. */
  pastEvents?: EventItem[];
  /**
   * El lineup relacionado de cada evento, por id (§7). Un evento que no
   * está acá todavía no se importó, y EventLineup cae al texto
   * congelado: entre la migración y el import, la página se ve igual.
   */
  lineups?: Record<number, LineupEntry[]>;
  /**
   * VENTA_ONLINE. Baja como prop y NO se lee del entorno acá porque este es un
   * client component: process.env no existe del lado del cliente salvo con un
   * NEXT_PUBLIC_, y eso serían DOS variables para lo mismo — que es exactamente
   * cómo una queda prendida y la otra apagada.
   *
   * Default false: si alguien renderiza esta lista sin pasar el flag, no vende.
   */
  ventaOnline?: boolean;
  /**
   * LAS CONVOCATORIAS ABIERTAS, por id de evento, YA FILTRADAS por visibilidad del lado del
   * server. Acá no se decide quién ve qué: si llegó, se muestra. Decidirlo también en el
   * cliente sería una segunda definición del filtro, y la del cliente es la que se puede
   * leer con las herramientas del navegador.
   */
  convocatorias?: Record<number, ConvocatoriaAbierta>;
  /** El perfil de DJ de quien mira. null = no tiene, y entonces no se le ofrece postularse. */
  artistSlug?: string | null;
  /** Listas y no Sets: un Set no cruza la frontera servidor/cliente. */
  pendientesEn?: number[];
  enLineupDe?: number[];
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
          <EventCard
            key={e.id}
            event={e}
            lineup={lineups[e.id]}
            ventaOnline={ventaOnline}
            convocatoria={convocatorias[e.id]}
            artistSlug={artistSlug}
            yaSePostulo={pendientesEn.includes(convocatorias[e.id]?.id ?? -1)}
            yaEnLineup={enLineupDe.includes(e.id)}
          />
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
              <EventCard key={e.id} event={e} past lineup={lineups[e.id]} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function EventCard({
  event: e,
  past = false,
  lineup,
  ventaOnline = false,
  convocatoria,
  artistSlug = null,
  yaSePostulo = false,
  yaEnLineup = false,
}: {
  event: EventItem;
  past?: boolean;
  ventaOnline?: boolean;
  /** Sin entradas —todavía no se importó— EventLineup cae al texto. */
  lineup?: LineupEntry[];
  /**
   * LA CONVOCATORIA ABIERTA DE ESTE EVENTO, si hay y si quien mira la puede ver. El filtro
   * de visibilidad lo hizo el SERVER: acá si llegó, se muestra. Decidirlo también del lado
   * del cliente sería una segunda definición del filtro, y la del cliente se puede leer con
   * las herramientas del navegador.
   */
  convocatoria?: ConvocatoriaAbierta;
  artistSlug?: string | null;
  yaSePostulo?: boolean;
  yaEnLineup?: boolean;
}) {
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
        {/* Los nombres que se resolvieron son links; los que no, texto
            plano. Un link a un 404 es peor que no tener link. */}
        <EventLineup
          entries={lineup}
          fallback={e.lineup}
          // SIN "block": line-clamp-2 ya pone display:-webkit-box, y
          // "block" lo pisa —gana por orden en el CSS compilado— dejando
          // el recorte a dos líneas sin efecto. Con dos o tres nombres no
          // se nota; con cinco, la tarjeta crece y rompe la grilla.
          className="mt-2 line-clamp-2 font-mono text-[10px] text-muted-foreground"
        />

        {/*
          LA HORA Y LA DURACIÓN, SOLO SI ESTÁN — Y EN LOS PASADOS TAMBIÉN.

          La hora se formatea en Bogotá y no como la vería el navegador de
          quien mire: una fiesta de las 23:00 en Bogotá no son las 23:00 en
          Madrid, y lo que hay que mostrar es a qué hora abre la puerta.

          La duración solo aparece cuando existen LOS DOS extremos. No se
          estima: un número inventado acá termina en el press kit de alguien.

          ESTE BLOQUE VIVÍA ADENTRO DE LA RAMA DE EVENTO NO PASADO, junto al
          precio y al botón, y por eso un evento terminado no decía ni a qué
          hora empezó ni cuánto duró. Se descubrió queriendo verificar en
          producción que un evento sin hora no muestra hora: los tres eventos
          de main ya habían pasado, así que el condicional no se evaluaba
          nunca y no había nada que observar.

          SE SACÓ DE AHÍ PORQUE LA HORA NO ES UNA CONDICIÓN DE VENTA. El
          precio y el botón sí dependen de que la fiesta no haya pasado —una
          fiesta terminada no es stock— pero la hora es un HECHO, y HOTU es
          archivo. Y el dato importa dos veces: la duración de un evento
          pasado es exactamente de donde STATS saca las horas tocadas, así
          que esconderla en la página era esconder justo lo que el press kit
          va a mostrar.

          PARA UN EVENTO FUTURO NO CAMBIA NADA: el bloque queda en el mismo
          lugar visual, antes del precio, y con el mismo markup. Lo único que
          cambió es que los pasados ahora lo alcanzan.
        */}
        {e.startsAt && (
          <div className="mt-3 font-mono text-[10px] tracking-widest text-muted-foreground">
            {horaEnBogota(e.startsAt)}
            {duracionEnPalabras(e.startsAt, e.endAt)
              ? ` · ${duracionEnPalabras(e.startsAt, e.endAt)}`
              : ""}
          </div>
        )}

        {past ? (
          // No price and no button: the party already happened.
          <div className="mt-3 font-mono text-[10px] tracking-widest text-muted-foreground">
            <AutoTranslate text="FINALIZADO" />
          </div>
        ) : (
          <>
            {/*
              EL PRECIO EN TAQUILLA, el que puso el organizador.

              Antes acá decía "Desde $30.000" con TICKET_PRICES.normal, una
              CONSTANTE: los cuatro eventos anunciaban el mismo precio, que
              nadie había decidido. Sacarlo no pierde información — dejar de
              mentir no es perder un dato — y lo que queda es lo que el
              organizador de verdad escribió, o nada.

              LA COMPARACIÓN ES !== null Y NO TRUTHY, y es el punto entero de
              que la columna sea nullable: 0 es falsy, así que con un
              if (doorPriceCop) una fiesta de entrada libre desaparecería del
              anuncio como si nadie hubiera dicho nada.
            */}
            {e.doorPriceCop !== null && (
              <div className="mt-3 font-mono text-sm font-bold">
                {e.doorPriceCop === 0 ? (
                  <AutoTranslate text="Entrada libre" />
                ) : (
                  <>
                    <AutoTranslate text="Taquilla:" /> {formatCOP(e.doorPriceCop)}
                  </>
                )}
              </div>
            )}
            {/* Con VENTA_ONLINE apagado no hay botón de comprar. El precio de
                arriba SÍ se sigue mostrando: es lo que cobra el organizador en la
                puerta, y eso no depende de que HOTU venda. */}
            {ventaOnline && <AddTicketButton eventId={e.id} eventTitle={e.title} />}

            {/**
              * LA CONVOCATORIA, ABAJO DE TODO Y SOLO EN LOS QUE NO PASARON.
              *
              * Dentro de la rama de no-finalizado, así que una fiesta que ya fue no muestra
              * nada aunque su convocatoria siguiera abierta en la base — que no puede, porque
              * la condición de ABIERTA incluye que el evento no haya pasado. Va acá igual: la
              * garantía es del server y esto es coherencia visual, no una segunda guarda.
              *
              * Y abajo del precio y del botón de comprar porque un visitante viene a ver la
              * fiesta; que estén buscando DJs es información para una minoría de quienes
              * miran.
              */}
            {convocatoria && (
              <PostularseAConvocatoria
                convocatoria={convocatoria}
                artistSlug={artistSlug}
                yaSePostulo={yaSePostulo}
                yaEnLineup={yaEnLineup}
              />
            )}
          </>
        )}
      </div>
    </article>
  );
}
