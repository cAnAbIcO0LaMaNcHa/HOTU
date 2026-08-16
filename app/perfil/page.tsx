import type { Metadata } from "next";
import Link from "next/link";
import { Package, Ticket as TicketIcon, LogIn, MapPin, ChevronRight } from "lucide-react";
import { auth } from "@/auth";
import { getMyOrders, getMyTickets, getMyProfile } from "@/lib/orders";
import { formatShortDate } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { ProfileHeader } from "@/components/profile-header";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mi perfil",
  description: "Tus pedidos y tiquetes en HOTU.",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDIENTE DE PAGO",
  paid: "PAGADO",
  cancelled: "CANCELADO",
};

export default async function PerfilPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
        <LogIn className="h-8 w-8 text-primary" />
        <h1 className="mt-4 text-3xl font-bold">Inicia sesion</h1>
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          Entra con tu cuenta de Google para ver tus pedidos y tiquetes.
        </p>
        <Link
          href="/auth/signin?callbackUrl=/perfil"
          className="surface-chrome sheen mt-6 inline-flex px-6 py-3 font-mono text-xs tracking-widest"
        >
          CONTINUAR CON GOOGLE
        </Link>
      </section>
    );
  }

  const [orders, tickets, profile] = await Promise.all([getMyOrders(), getMyTickets(), getMyProfile()]);
  const ticketsPreview = tickets.slice(0, 3);

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <ProfileHeader
        name={session.user.name ?? "Perfil"}
        email={session.user.email ?? ""}
        image={session.user.image}
        ordersCount={orders.length}
        ticketsCount={tickets.length}
        initialPhone={profile.phone}
        initialCedula={profile.cedula}
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
              <div
                key={t.orderItemId}
                data-district={t.district}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
