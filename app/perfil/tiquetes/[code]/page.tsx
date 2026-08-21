import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { ArrowLeft, MapPin, Calendar, Ticket as TicketIcon, ShieldCheck, User, Phone, Mail } from "lucide-react";
import { auth } from "@/auth";
import { getMyTicketByCode } from "@/lib/tickets";
import { getMyProfile } from "@/lib/orders";
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

  const [ticket, profile] = await Promise.all([getMyTicketByCode(code), getMyProfile()]);

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

  // Light modules stay white on purpose — a QR needs that contrast to
  // scan reliably no matter what's behind it. It renders at a fixed pixel
  // size and then scales via CSS to fill its box, so it stays crisp at
  // any container width.
  const qrSvg = await QRCode.toString(verifyUrl, {
    type: "svg",
    margin: 1,
    width: 240,
    color: { dark: "#ffffff", light: "#000000" },
  });

  const displayCode = ticket.displayCode ?? `HOTU-${String(ticket.id).padStart(6, "0")}`;
  const isUsed = ticket.status === "checked_in";

  return (
    <section className="mx-auto max-w-xl px-4 py-16 md:py-24">
      <Link
        href="/perfil/tiquetes"
        className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> MIS TIQUETES
      </Link>

      {/* THE TICKET CANVAS — fixed 9:16, the same ratio as a phone screen
          and the standard size promoters already use for flyer art
          (1080x1920, Instagram Story format). This is the piece meant to
          connect to the app later.

          Background: the event's flyer image if it has one, else the
          current district-themed placeholder. Content sits in a single
          panel over it: info on the left, the QR pinned to the right in
          its own solid-black box — that box stays solid no matter what's
          behind it, so scanning never depends on how busy or dark the
          flyer art is. */}
      <div
        data-district={ticket.district}
        className={`sheen relative mx-auto mt-6 aspect-[9/16] w-full max-w-[400px] overflow-hidden rounded-lg ${
          ticket.flyerUrl ? "" : "border-chrome"
        }`}
      >
        {ticket.flyerUrl ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${ticket.flyerUrl})` }}
            />
            <div className="absolute inset-0 bg-black/10" />
          </>
        ) : null}

        {/* Top bar: brand + tier/status, readable over any background */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-black/45 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <TicketIcon className="h-4 w-4 text-white" />
            <span className="font-mono text-[9px] tracking-widest text-white/80">HOTU</span>
          </div>
          <div className="flex items-center gap-2">
            {isUsed && (
              <span className="border border-white/40 px-2 py-1 font-mono text-[8px] tracking-widest text-white/70">
                USADA
              </span>
            )}
            <span className="border border-primary px-2 py-1 font-mono text-[8px] tracking-widest text-primary">
              {ticket.tier === "vip" ? "VIP" : "NORMAL"}
            </span>
          </div>
        </div>

        {/* Main panel: info on the left, QR pinned right */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex gap-3 bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex min-w-0 flex-1 flex-col gap-2 font-mono text-white">
            <div>
              <div className="text-[9px] tracking-widest text-white/60">
                {formatShortDate(ticket.eventDate)}
              </div>
              <h1 className="text-xl font-bold leading-tight">
                <AutoTranslate text={ticket.eventTitle} />
              </h1>
              <div className="mt-1 flex items-center gap-1 text-[9px] tracking-widest text-white/60">
                <MapPin className="h-3 w-3 shrink-0" /> {ticket.venue} · {ticket.city}
              </div>
            </div>

            <div className="flex flex-col gap-0.5 border-t border-white/20 pt-2 text-[9px] text-white/70">
              <div className="flex items-center gap-2">
                <User className="h-3 w-3 shrink-0" /> {session.user.name ?? "—"}
              </div>
              {profile.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3 w-3 shrink-0" /> {profile.phone}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Mail className="h-3 w-3 shrink-0" /> {session.user.email}
              </div>
            </div>

            {isUsed ? (
              <p className="text-[9px] tracking-widest text-white/60">
                ⬤ YA FUE USADA
                {ticket.checkedInAt && <> — {new Date(ticket.checkedInAt).toLocaleString("es-CO")}</>}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[9px] tracking-widest text-primary">
                <ShieldCheck className="h-3 w-3" /> ENTRADA VÁLIDA
              </p>
            )}
          </div>

          {/* QR: pinned to the right, solid black box, white code — the
              "standard" safe-zone every flyer background has to leave
              alone once real flyer art gets wired in. */}
          <div className="flex w-[34%] shrink-0 flex-col items-center justify-center gap-1.5">
            <div className="w-full rounded bg-black p-[8%] shadow-lg">
              <div
                className={`w-full [&_svg]:h-auto [&_svg]:w-full ${isUsed ? "opacity-30 grayscale" : ""}`}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            </div>
            <div className="text-center font-mono text-[9px] tracking-[0.1em] text-white">{displayCode}</div>
          </div>
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-[400px] font-mono text-[10px] leading-relaxed text-muted-foreground">
        Esta entrada es personal e intransferible. El código QR es único — una vez escaneado en la
        puerta queda marcado como usado y una captura de pantalla ya no sirve para entrar de nuevo.
      </p>
    </section>
  );
}
