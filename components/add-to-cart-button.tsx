"use client";

import { useCart } from "@/components/cart-context";

export function AddToCartButton({ slug, name, unitPriceCop }: { slug: string; name: string; unitPriceCop: number }) {
  const { addMerch } = useCart();
  return (
    <button
      onClick={() => addMerch({ slug, name, unitPriceCop })}
      className="surface-chrome sheen mt-5 w-full py-2.5 font-mono text-[11px] tracking-widest"
    >
      AGREGAR AL CARRITO
    </button>
  );
}
