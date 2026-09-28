"use client";

import { useState } from "react";
import type { MerchItem } from "@/lib/commerce-types";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { CollectiveFilterButton, type CollectiveOption } from "@/components/collective-filter-button";

const CATEGORY_LABEL: Record<string, string> = {
  camiseta: "CAMISETAS",
  saco: "SACOS",
  pasamontanas: "PASAMONTAÑAS",
  buckethat: "BUCKET HATS",
  abanico: "ABANICOS",
  earplugs: "EARPLUGS",
  arte: "ARTE",
};

const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export function TiendaList({
  items,
  collectives,
  ventaOnline = false,
}: {
  items: MerchItem[];
  collectives: CollectiveOption[];
  /**
   * VENTA_ONLINE, bajado como prop. No se lee del entorno acá: este es un client
   * component y process.env no existe del lado del cliente salvo con un
   * NEXT_PUBLIC_, y eso serían DOS variables para lo mismo — que es exactamente
   * cómo una queda prendida y la otra apagada.
   *
   * Default false: si alguien lo renderiza sin pasar el flag, no vende.
   */
  ventaOnline?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(slug: string) {
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }
  function clear() {
    setSelected([]);
  }

  // Push matching-collective items to the front — nothing ever hides.
  const sorted =
    selected.length === 0
      ? items
      : [
          ...items.filter((i) => i.collectiveSlug && selected.includes(i.collectiveSlug)),
          ...items.filter((i) => !i.collectiveSlug || !selected.includes(i.collectiveSlug)),
        ];

  return (
    <>
      <div className="mt-6">
        <CollectiveFilterButton collectives={collectives} selected={selected} onToggle={toggle} onClear={clear} />
      </div>

      {sorted.length === 0 ? (
        <p className="mt-16 font-mono text-sm text-muted-foreground">Catálogo en construcción.</p>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {sorted.map((item) => (
            <div key={item.slug} className="sheen border-chrome flex flex-col justify-between p-5">
              <div>
                <span className="font-mono text-[9px] tracking-[0.3em] text-primary">
                  {CATEGORY_LABEL[item.category] ?? item.category.toUpperCase()}
                </span>
                <h3 className="mt-2 text-lg font-bold leading-tight">{item.name}</h3>
                <p className="mt-2 font-mono text-sm text-muted-foreground">{formatCOP(item.priceCop)}</p>
              </div>
              {/* Con VENTA_ONLINE apagado la tienda es un CATÁLOGO: el precio y la
                  foto se siguen viendo, lo que no hay es cómo comprar. Es lo que
                  se podía hacer ayer menos una cosa, y es la cosa que se decidió
                  apagar — no un efecto secundario. */}
              {ventaOnline ? (
                <AddToCartButton slug={item.slug} name={item.name} unitPriceCop={item.priceCop} />
              ) : (
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  Todavía no vendemos por acá. Escribinos para conseguirlo.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
