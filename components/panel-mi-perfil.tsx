import Link from "next/link";
import { Package, Ticket as TicketIcon, MapPin, ChevronRight } from "lucide-react";
import { getMyOrders, getMyProfile } from "@/lib/orders";
import { getMyTicketInstances } from "@/lib/tickets";
import { formatShortDate, getLikedArtists, getLikedCollectives } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { ProfileHeader } from "@/components/profile-header";
import { LikedArtists } from "@/components/liked-artists";

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDIENTE DE PAGO",
  paid: "PAGADO",
  cancelled: "CANCELADO",
};

/**
 * Panel MI PERFIL: la cuenta base, la que tiene cualquiera.
 *
 * Datos de la cuenta, pedidos, tiquetes, y las tres secciones de lo que
 * me gusta. Nada de esto depende de ser DJ, dueño de colectivo ni de
 * venue: es lo que ve una persona que solo compra entradas.
 *
 * Es el panel por defecto justamente por eso — es el único que está
 * garantizado que tiene contenido.
 */
export async function PanelMiPerfil({
  email,
  nombre,
  imagen,
}: {
  email: string;
  nombre: string;
  imagen?: string | null;
}) {
  const [orders, tickets, profile, likedArtists, likedColectivos, likedVenues] =
    await Promise.all([
      getMyOrders(),
      getMyTicketInstances(),
      getMyProfile(),
      getLikedArtists(email),
      getLikedCollectives(email, "collective"),
      getLikedCollectives(email, "venue"),
    ]);
  const ticketsPreview = tickets.slice(0, 3);

  return (
    <>
      <ProfileHeader
        name={nombre}
        email={email}
        image={imagen}
        ordersCount={orders.length}
        ticketsCount={tickets.length}
        initialPhone={profile.phone}
        initialHasConsent={profile.hasConsent}
      />

      {/* Mis pedidos */}
      <div className="mt-16">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Package className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">MIS PEDIDOS</h2>
        </div>

        {orders.length === 0 ? (
          <p className="mt-6 font-mono text-sm text-muted-foreground">
            Todavia no tenes pedidos. Compra entradas o merch desde el carrito.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            {orders.map((o) => (
              <div key={o.id} className="border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs tracking-widest text-muted-foreground">
                    PEDIDO #{o.id} - {new Date(o.createdAt).toLocaleDateString("es-CO")}
                  </div>
                  <span
                    className={`border px-2 py-1 font-mono text-[10px] tracking-widest ${
                      o.status === "paid"
                        ? "border-primary text-primary"
                        : "border-muted-foreground text-muted-foreground"
                    }`}
                  >
                    {STATUS_LABEL[o.status] ?? o.status.toUpperCase()}
                  </span>
                </div>
                <ul className="mt-4 flex flex-col gap-1 font-mono text-sm">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span className="truncate">
                        {it.quantity} {it.name}
                        {it.ticketTier ? ` (${it.ticketTier === "vip" ? "VIP" : "Normal"})` : ""}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
                          it.unitPriceCop * it.quantity
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-border pt-3 text-right font-mono text-sm font-bold">
                  TOTAL:{" "}
                  {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(o.amountCop)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mis tiquetes */}
      <div className="mt-16">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <TicketIcon className="h-4 w-4 text-primary" />
            <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">MIS TIQUETES</h2>
          </div>
          {tickets.length > 0 && (
            <Link
              href="/perfil/tiquetes"
              className="inline-flex items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary"
            >
              VER TODOS <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {tickets.length === 0 ? (
          <p className="mt-6 font-mono text-sm text-muted-foreground">
            Todavia no tenes tiquetes. Se agregan automaticamente cuando compras y pagas una entrada.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {ticketsPreview.map((t) => (
              <Link
                key={t.id}
                href={`/perfil/tiquetes/${t.ticketCode}`}
                className="sheen border-chrome flex flex-col justify-between p-5"
              >
                <TicketIcon className="h-6 w-6 text-chrome" />
                <div className="mt-6">
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    {formatShortDate(t.eventDate)}
                  </div>
                  <div className="mt-1 font-bold leading-tight">
                    <AutoTranslate text={t.eventTitle} />
                  </div>
                  <div className="mt-2 flex items-center gap-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {t.city}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Tres secciones y no una lista mezclada: para el usuario son
          tres cosas distintas, igual que /artistas, /colectivos y
          /venues son tres secciones. Cada una no se renderiza si está
          vacía, que es la regla de siempre. */}
      <LikedArtists artists={likedArtists} />
      <LikedArtists
        artists={likedColectivos}
        title="COLECTIVOS QUE ME GUSTAN"
        hrefBase="/colectivos"
      />
      <LikedArtists artists={likedVenues} title="VENUES QUE ME GUSTAN" hrefBase="/venues" />
    </>
  );
}
