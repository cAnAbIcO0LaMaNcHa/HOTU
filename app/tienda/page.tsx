import type { Metadata } from "next";
import { getMerchCatalog } from "@/lib/orders";
import { AddToCartButton } from "@/components/add-to-cart-button";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Tienda HOTU",
  description: "Merch oficial de HOTU: ropa y accesorios para raves.",
};

const CATEGORY_LABEL: Record<string, string> = {
  camiseta: "CAMISETAS",
  saco: "SACOS",
  pasamontanas: "PASAMONTAÑAS",
  buckethat: "BUCKET HATS",
  abanico: "ABANICOS",
  earplugs: "EARPLUGS",
  arte: "ARTE",
};

export default async function TiendaPage() {
  const items = await getMerchCatalog();

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ MERCH OFICIAL
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">TIENDA</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground">
        Agregá lo que quieras al carrito y finalizá el pedido. El cobro en línea se activa próximamente.
      </p>

      {items.length === 0 ? (
        <p className="mt-16 font-mono text-sm text-muted-foreground">Catálogo en construcción.</p>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.slug} className="sheen border-chrome flex flex-col justify-between p-5">
              <div>
                <span className="font-mono text-[9px] tracking-[0.3em] text-primary">
                  {CATEGORY_LABEL[item.category] ?? item.category.toUpperCase()}
                </span>
                <h3 className="mt-2 text-lg font-bold leading-tight">{item.name}</h3>
                <p className="mt-2 font-mono text-sm text-muted-foreground">
                  {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
                    item.priceCop
                  )}
                </p>
              </div>
              <AddToCartButton slug={item.slug} name={item.name} unitPriceCop={item.priceCop} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
