import type { Metadata } from "next";
import { getMerchCatalog } from "@/lib/orders";
import { getAllCollectives } from "@/lib/db";
import { TiendaList } from "@/components/tienda-list";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Tienda HOTU",
  description: "Merch oficial de HOTU: ropa y accesorios para raves.",
};

export default async function TiendaPage() {
  const [items, collectives] = await Promise.all([getMerchCatalog(), getAllCollectives()]);
  const collectiveOptions = collectives.map((c) => ({ slug: c.slug, name: c.name }));

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        ▶ MERCH OFICIAL
      </span>
      <h1 className="mt-6 text-5xl font-bold leading-[0.9] md:text-7xl">TIENDA</h1>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        Agregá lo que quieras al carrito y finalizá el pedido. El cobro en línea se activa próximamente.
      </p>

      <TiendaList items={items} collectives={collectiveOptions} />
    </section>
  );
}
