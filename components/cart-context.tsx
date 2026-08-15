"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CartItem } from "@/lib/commerce-types";

type CartContextValue = {
  items: CartItem[];
  addTicket: (item: { eventId: number; eventTitle: string; tier: "normal" | "vip"; unitPriceCop: number }) => void;
  addMerch: (item: { slug: string; name: string; unitPriceCop: number }) => void;
  removeItem: (index: number) => void;
  setQuantity: (index: number, quantity: number) => void;
  clear: () => void;
  totalCop: number;
  count: number;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "hotu-cart";

function cartKey(item: CartItem) {
  return item.kind === "ticket" ? `ticket:${item.eventId}:${item.tier}` : `merch:${item.slug}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {
      // ignore corrupt cart data
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const addTicket: CartContextValue["addTicket"] = (item) => {
    setItems((prev) => {
      const key = `ticket:${item.eventId}:${item.tier}`;
      const idx = prev.findIndex((i) => cartKey(i) === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { kind: "ticket", quantity: 1, ...item }];
    });
    setOpen(true);
  };

  const addMerch: CartContextValue["addMerch"] = (item) => {
    setItems((prev) => {
      const key = `merch:${item.slug}`;
      const idx = prev.findIndex((i) => cartKey(i) === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { kind: "merch", quantity: 1, ...item }];
    });
    setOpen(true);
  };

  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const setQuantity = (index: number, quantity: number) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, quantity: Math.max(1, quantity) } : it)));

  const clear = () => setItems([]);

  const totalCop = items.reduce((sum, it) => sum + it.unitPriceCop * it.quantity, 0);
  const count = items.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addTicket, addMerch, removeItem, setQuantity, clear, totalCop, count, open, setOpen }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

export function formatCop(cop: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(cop);
}
