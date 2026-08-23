"use client";

import { useState } from "react";
import { useCart } from "@/components/cart-context";
import { TICKET_PRICES, type TicketTier } from "@/lib/commerce-types";

export function AddTicketButton({ eventId, eventTitle }: { eventId: number; eventTitle: string }) {
  const { addTicket } = useCart();
  const [tier, setTier] = useState<TicketTier>("normal");

  return (
    <div className="mt-5">
      <div className="flex gap-2">
        {(["normal", "vip"] as const).map((tKey) => (
          <button
            key={tKey}
            onClick={() => setTier(tKey)}
            className={`flex-1 border px-2 py-1.5 font-mono text-[10px] tracking-widest ${
              tier === tKey ? "border-primary text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {tKey === "vip" ? "VIP" : "NORMAL"}
          </button>
        ))}
      </div>
      <button
        onClick={() => addTicket({ eventId, eventTitle, tier, unitPriceCop: TICKET_PRICES[tier] })}
        className="mt-2 w-full bg-primary py-2.5 font-mono text-[11px] tracking-widest text-background transition-opacity hover:opacity-90"
      >
        AGREGAR ENTRADA · {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(TICKET_PRICES[tier])}
      </button>
    </div>
  );
}
