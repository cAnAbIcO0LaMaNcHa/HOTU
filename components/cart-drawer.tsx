"use client";

import { useState, useTransition } from "react";
import { X, Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { useCart, formatCop } from "@/components/cart-context";
import { createPendingOrder } from "@/lib/actions";
import { useLanguage } from "@/lib/i18n";

export function CartDrawer() {
  const { items, open, setOpen, removeItem, setQuantity, totalCop, clear } = useCart();
  const { t } = useLanguage();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<null | "ok" | "error" | "auth">(null);

  if (!open) return null;

  const checkout = () => {
    setStatus(null);
    startTransition(async () => {
      const result = await createPendingOrder(items);
      if ("error" in result) {
        setStatus(result.error === "not_authenticated" ? "auth" : "error");
        return;
      }
      setStatus("ok");
      clear();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
      <div className="concrete relative flex h-full w-full max-w-md flex-col border-l border-border">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-primary">
            <ShoppingBag className="h-4 w-4" /> {t("tickets")} / TIENDA
          </div>
          <button onClick={() => setOpen(false)} aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 && (
            <p className="mt-8 text-center font-mono text-sm text-muted-foreground">Tu carrito está vacío.</p>
          )}
          <div className="flex flex-col gap-4">
            {items.map((it, i) => (
              <div key={i} className="border-b border-border pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{it.kind === "ticket" ? it.eventTitle : it.name}</div>
                    <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                      {it.kind === "ticket" ? `Entrada ${it.tier === "vip" ? "VIP" : "Normal"}` : "Merch"}
                    </div>
                  </div>
                  <button onClick={() => removeItem(i)} aria-label="Quitar" className="shrink-0 text-muted-foreground hover:text-primary">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setQuantity(i, it.quantity - 1)} className="border border-border p-1"><Minus className="h-3 w-3" /></button>
                    <span className="w-6 text-center font-mono text-sm">{it.quantity}</span>
                    <button onClick={() => setQuantity(i, it.quantity + 1)} className="border border-border p-1"><Plus className="h-3 w-3" /></button>
                  </div>
                  <span className="font-mono text-sm">{formatCop(it.unitPriceCop * it.quantity)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between font-mono text-sm">
            <span className="text-muted-foreground">TOTAL</span>
            <span className="text-lg font-bold">{formatCop(totalCop)}</span>
          </div>

          {status === "auth" && (
            <p className="mt-3 font-mono text-xs text-primary">Iniciá sesión con Google para continuar tu compra.</p>
          )}
          {status === "error" && (
            <p className="mt-3 font-mono text-xs text-primary">Algo falló. Probá de nuevo en un momento.</p>
          )}
          {status === "ok" && (
            <p className="mt-3 font-mono text-xs text-primary">
              ¡Pedido reservado! Todavía estamos activando el pago en línea — te vamos a confirmar por este medio para coordinar el cobro.
            </p>
          )}

          <button
            onClick={checkout}
            disabled={items.length === 0 || isPending}
            className="surface-chrome sheen mt-4 w-full py-3 font-mono text-xs tracking-widest disabled:opacity-40"
          >
            {isPending ? "PROCESANDO..." : "FINALIZAR PEDIDO"}
          </button>
          <p className="mt-2 text-center font-mono text-[9px] text-muted-foreground">
            El cobro en línea con Bold se activa próximamente.
          </p>
        </div>
      </div>
    </div>
  );
}
