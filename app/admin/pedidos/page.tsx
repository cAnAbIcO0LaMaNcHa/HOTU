import { getAllOrdersAdmin } from "@/lib/orders";
import { markOrderPaid } from "@/lib/tickets-write";

export const revalidate = 0;

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDIENTE",
  paid: "PAGADO",
  cancelled: "CANCELADO",
};

export default async function AdminPedidos() {
  const orders = await getAllOrdersAdmin();

  return (
    <div className="space-y-8">
      <div className="border border-primary p-6">
        <h2 className="text-xl font-bold">PEDIDOS ({orders.length})</h2>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Marcá un pedido como pagado para emitir sus tiquetes (cada entrada recibe su propio código QR
          seguro). Esto reemplaza temporalmente al webhook de pago mientras Bold no esté conectado.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {orders.map((o) => (
          <div key={o.id} className="border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-xs tracking-widest">
                  PEDIDO #{o.id} · {o.userEmail}
                </div>
                <div className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                  {new Date(o.createdAt).toLocaleString("es-CO")}
                </div>
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

            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <div className="font-mono text-sm font-bold">
                TOTAL:{" "}
                {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
                  o.amountCop
                )}
              </div>
              {o.status !== "paid" && (
                <form action={markOrderPaid}>
                  <input type="hidden" name="orderId" value={o.id} />
                  <button
                    type="submit"
                    className="border border-primary px-4 py-2 font-mono text-xs tracking-widest text-primary hover:surface-chrome"
                  >
                    MARCAR COMO PAGADO
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
        {orders.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground">No hay pedidos todavía.</p>
        )}
      </div>
    </div>
  );
}
