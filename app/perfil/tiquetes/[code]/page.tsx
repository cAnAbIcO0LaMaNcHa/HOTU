import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { ArrowLeft, MapPin, Calendar, Ticket as TicketIcon, ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { getMyTicketByCode } from "@/lib/tickets";
import { formatShortDate } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Tu entrada",
};

export default async function TicketDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await auth();

  if (!session?.user) {
    return (
      <section className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">Inicia sesión</h1>
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          Entra con tu cuenta de Google para ver esta entrada.
        </p>
        <Link
          href={`/auth/signin?callbackUrl=/perfil/tiquetes/${code}`}
          className="surface-chrome sheen mt-6 inline-flex px-6 py-3 font-mono text-xs tracking-widest"
        >
          CONTINUAR CON GOOGLE
        </Link>
      </section>
    );
  }

  const ticket = await getMyTicketByCode(code);

  if (!ticket) {
    return (
      <section className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">Entrada no encontrada</h1>
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          Este código no corresponde a ninguna de tus entradas.
        </p>
        <Link
          href="/perfil/tiquetes"
          className="mt-6 inline-flex items-center gap-2 border border-border px-6 py-3 font-mono text-xs tracking-widest hover:border-primary"
        >
          <ArrowLeft className="h-3 w-3" /> VOLVER A MIS TIQUETES
        </Link>
      </section>
    );
  }

  // Build the door-verification URL using the actual request host, so it
  // works correctly on preview deployments and any future custom domain
  // without needing a hardcoded site URL.
  const h = await headers();
  const host = h.get("host") ?? "hotu-one.vercel.app";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const verifyUrl = `${proto}://${host}/verificar/${ticket.ticketCode}`;

  const qrSvg = await QRCode.toString(verifyUrl, {
    type: "svg",
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const ticketNumber = `HOTU-${String(ticket.id).padStart(6, "0")}`;
  const isUsed = ticket.status === "checked_in";

  return (
    <section className="mx-auto max-w-lg px-4 py-16 md:py-24">
      <Link
        href="/perfil/tiquetes"
        className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> MIS TIQUETES
      </Link>

      <div data-district={ticket.district} className="sheen border-chrome mt-6 overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-0">
          <TicketIcon className="h-6 w-6 text-chrome" />
          <span className="border border-primary px-2 py-1 font-mono text-[9px] tracking-widest text-primary">
            {ticket.tier === "vip" ? "VIP" : "NORMAL"}
          </span>
        </div>

        <div className="p-6">
          <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
            {formatShortDate(ticket.eventDate)}
          </div>
          <h1 className="mt-1 text-2xl font-bold leading-tight">
            <AutoTranslate text={ticket.eventTitle} />
          </h1>
          <div className="mt-3 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-3 w-3 shrink-0" />
              {new Date(ticket.eventDate).toLocaleDateString("es-CO", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-3 w-3 shrink-0" /> {ticket.venue} · {ticket.city}
            </div>
          </div>
        </div>

        {/* QR always sits on a plain white card, regardless of site theme or
            district color, so it scans reliably under any light. */}
        <div className="flex flex-col items-center gap-3 bg-white p-6">
          <div
            className={`h-56 w-56 ${isUsed ? "opacity-30 grayscale" : ""}`}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="font-mono text-[10px] tracking-widest text-black/60">{ticketNumber}</div>
        </div>

        <div className="border-t border-border/60 p-6">
          {isUsed ? (
            <p className="font-mono text-xs tracking-widest text-muted-foreground">
              ⬤ ESTA ENTRADA YA FUE USADA
              {ticket.checkedInAt && (
                <> — {new Date(ticket.checkedInAt).toLocaleString("es-CO")}</>
              )}
            </p>
          ) : (
            <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-primary">
              <ShieldCheck className="h-4 w-4" /> ENTRADA VÁLIDA — MOSTRÁ ESTE QR EN LA PUERTA
            </p>
          )}
        </div>
      </div>

      <p className="mt-6 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Esta entrada es personal e intransferible. El código QR es único — una vez escaneado en la
        puerta queda marcado como usado y una captura de pantalla ya no sirve para entrar de nuevo.
      </p>
    </section>
  );
}
