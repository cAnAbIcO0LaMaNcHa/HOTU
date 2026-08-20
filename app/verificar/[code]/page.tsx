import type { Metadata } from "next";
import { CheckCircle2, XCircle, ShieldAlert, MapPin, Calendar } from "lucide-react";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { getTicketForVerification } from "@/lib/tickets";
import { checkInTicket } from "@/lib/tickets-write";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Verificar entrada",
  robots: { index: false, follow: false },
};

export default async function VerificarPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await auth();
  const isDoorStaff = isAdminEmail(session?.user?.email);

  const ticket = await getTicketForVerification(code);

  if (!ticket) {
    return (
      <section className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <XCircle className="h-16 w-16 text-red-400" />
        <h1 className="mt-6 text-2xl font-bold">CÓDIGO INVÁLIDO</h1>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          Este QR no corresponde a ninguna entrada de HOTU.
        </p>
      </section>
    );
  }

  const isValid = ticket.status === "valid";
  const isUsed = ticket.status === "checked_in";

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
      {isValid && <CheckCircle2 className="h-16 w-16 text-primary" />}
      {isUsed && <ShieldAlert className="h-16 w-16 text-yellow-400" />}
      {ticket.status === "cancelled" && <XCircle className="h-16 w-16 text-red-400" />}

      <h1 className="mt-6 text-3xl font-bold">
        {isValid && "ENTRADA VÁLIDA"}
        {isUsed && "YA FUE USADA"}
        {ticket.status === "cancelled" && "ENTRADA CANCELADA"}
      </h1>

      <div className="mt-6 w-full border border-border bg-card p-5 text-left">
        <div className="font-mono text-[10px] tracking-widest text-primary">{ticket.tier === "vip" ? "VIP" : "NORMAL"}</div>
        <div className="mt-1 text-xl font-bold">{ticket.eventTitle}</div>
        <div className="mt-3 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><Calendar className="h-3 w-3" /> {ticket.eventDate}</div>
          <div className="flex items-center gap-2"><MapPin className="h-3 w-3" /> {ticket.venue} · {ticket.city}</div>
        </div>
      </div>

      {isUsed && ticket.checkedInAt && (
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          Ingresó el {new Date(ticket.checkedInAt).toLocaleString("es-CO")}
        </p>
      )}

      {isDoorStaff && isValid && (
        <form action={checkInTicket} className="mt-8 w-full">
          <input type="hidden" name="code" value={ticket.ticketCode} />
          <button
            type="submit"
            className="surface-chrome sheen w-full py-4 font-mono text-sm tracking-widest"
          >
            MARCAR INGRESO
          </button>
        </form>
      )}

      {!isDoorStaff && (
        <p className="mt-8 font-mono text-[10px] tracking-widest text-muted-foreground">
          SOLO EL EQUIPO HOTU EN LA PUERTA PUEDE MARCAR EL INGRESO
        </p>
      )}
    </section>
  );
}
