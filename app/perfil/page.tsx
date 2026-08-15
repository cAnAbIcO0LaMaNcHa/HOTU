import type { Metadata } from "next";
import Link from "next/link";
import { Trophy, Package, LogIn } from "lucide-react";
import { auth } from "@/auth";
import { getMyOrders, getMyTrophies } from "@/lib/orders";
import { formatShortDate } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mi perfil",
  description: "Tus pedidos y las fiestas HOTU a las que has asistido.",
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
          Entra con tu cuenta de Google para ver tus pedidos y las fiestas a las que has asistido.
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

  const [orders, trophies] = await Promise.all([getMyOrders(), getMyTrophies()]);

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        MI CASA
      </span>
      <h1 className="mt-6 text-4xl font-bold leading-[0.95] md:text-6xl">
        {session.user.name?.split(" ")[0]?.toUpperCase() ?? "PERFIL"}
      </h1>
      <p className="mt-3 font-mono text-xs text-muted-foreground">{session.user.email}</p>

      <div className="mt-16">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Trophy className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">TROFEOS - FIESTAS A LAS QUE HAS IDO</h2>
        </div>

        {trophies.length === 0 ? (
          <p className="mt-6 font-mono text-sm text-muted-foreground">
            Todavia no tenes trofeos. Se desbloquean automaticamente cuando compras y pagas una entrada.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {trophies.map((tr) => (
              <div
                key={tr.eventId}
                data-district={tr.district}
                className="sheen border-chrome flex flex-col justify-between p-5"
              >
                <Trophy className="h-6 w-6 text-chrome" />
                <div className="mt-6">
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    {formatShortDate(tr.eventDate)}
                  </div>
                  <div className="mt-1 font-bold leading-tight">
                    <AutoTranslate text={tr.eventTitle} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
    </section>
  );
}
