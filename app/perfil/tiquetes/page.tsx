import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Ticket as TicketIcon, MapPin, LogIn } from "lucide-react";
import { auth } from "@/auth";
import { getMyTickets } from "@/lib/orders";
import { formatShortDate } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mis tiquetes",
  description: "Todas las boletas que has comprado en HOTU.",
};

export default async function TiquetesPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
        <LogIn className="h-8 w-8 text-primary" />
        <h1 className="mt-4 text-3xl font-bold">Inicia sesion</h1>
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          Entra con tu cuenta de Google para ver tus tiquetes.
        </p>
        <Link
          href="/auth/signin?callbackUrl=/perfil/tiquetes"
          className="surface-chrome sheen mt-6 inline-flex px-6 py-3 font-mono text-xs tracking-widest"
        >
          CONTINUAR CON GOOGLE
        </Link>
      </section>
    );
  }

  const tickets = await getMyTickets();

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <Link
        href="/perfil"
        className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> MI PERFIL
      </Link>

      <div className="mt-6 flex items-center gap-2">
        <TicketIcon className="h-5 w-5 text-primary" />
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary">MIS TIQUETES</span>
      </div>
      <h1 className="mt-3 text-4xl font-bold leading-[0.95] md:text-6xl">TUS BOLETAS</h1>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        Acá se va llenando cada boleta que compras y pagas en HOTU — tu colección de fiestas.
      </p>

      {tickets.length === 0 ? (
        <p className="mt-16 font-mono text-sm text-muted-foreground">
          Todavía no tenés tiquetes. Se agregan automáticamente cuando compras y pagás una entrada.
        </p>
      ) : (
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.map((t) => (
            <div
              key={t.orderItemId}
              data-district={t.district}
              className="sheen border-chrome relative flex flex-col justify-between overflow-hidden p-6"
            >
              <div className="flex items-start justify-between">
                <TicketIcon className="h-6 w-6 text-chrome" />
                <span className="border border-primary px-2 py-1 font-mono text-[9px] tracking-widest text-primary">
                  {t.tier === "vip" ? "VIP" : "NORMAL"}
                  {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                </span>
              </div>
              <div className="mt-8">
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                  {formatShortDate(t.eventDate)}
                </div>
                <h3 className="mt-1 text-xl font-bold leading-tight">
                  <AutoTranslate text={t.eventTitle} />
                </h3>
                <div className="mt-2 flex items-center gap-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {t.city} · {t.venue}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
