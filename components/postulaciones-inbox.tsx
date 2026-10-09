"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import type { PostulacionDelArtista } from "@/lib/convocatorias-read";

/**
 * LA BANDEJA DE POSTULACIONES DEL DJ (§7).
 *
 * Va en /perfil?panel=artista, al lado de MembershipInbox y ColabInbox, que es el patrón que ya
 * existe: las cosas que esperan una respuesta, o que SON una respuesta, viven juntas.
 *
 * ============================================================
 * MUESTRA EL HISTÓRICO, NO SOLO LO ABIERTO
 * ============================================================
 *
 * Es lo contrario de la vitrina de /eventos, y a propósito. Lo que el DJ necesita saber es EN
 * QUÉ QUEDÓ CADA UNA: aceptada, rechazada, retirada o cancelada, con su motivo cuando hay.
 * Filtrar por convocatoria abierta le esconderían justamente las resueltas, que son las que
 * tienen una respuesta.
 *
 * Y es la única forma que tiene de enterarse hoy: lib/mail.ts registra el aviso en mail_outbox
 * pero todavía no hay proveedor, así que el mail no sale. Si esta bandeja no existiera, el DJ
 * no tendría NINGÚN lugar donde ver que le contestaron — y la fila estaría en la base
 * respondiéndole a nadie.
 *
 * ============================================================
 * RETIRARSE SOLO DONDE SE PUEDE
 * ============================================================
 *
 * El botón aparece únicamente en las pendientes de una convocatoria ABIERTA. El write path
 * niega las demás con 409, pero ofrecer el botón y que falle sería hacerle descubrir la regla
 * con un error — el mismo criterio que la tarjeta de /eventos.
 */

const TEXTO: Record<string, { rotulo: string; dice: string }> = {
  aceptada: { rotulo: "ACEPTADA", dice: "Estás en el lineup." },
  rechazada: { rotulo: "NO QUEDÓ", dice: "No te eligieron esta vez." },
  retirada: { rotulo: "TE RETIRASTE", dice: "La bajaste vos." },
  cancelada: {
    rotulo: "CANCELADA",
    dice: "Te habían aceptado y después cancelaron tu participación.",
  },
};

export function PostulacionesInbox({ postulaciones }: { postulaciones: PostulacionDelArtista[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * SIN POSTULACIONES NO SE RENDERIZA NADA, igual que MisEventos.
   *
   * Es la regla del EPK: las secciones vacías no se muestran. Un DJ que nunca se postuló no
   * tiene por qué ver una caja vacía explicándole algo que no usó — y si quiere postularse, el
   * lugar es /eventos, no acá.
   */
  if (postulaciones.length === 0) return null;

  async function retirar(id: number) {
    if (!window.confirm("¿Retirar tu postulación? Podés volver a postularte si sigue abierta.")) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/postulaciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: id, accion: "retirar" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar. Probá de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  const pendientes = postulaciones.filter((p) => !p.resultado);
  const resueltas = postulaciones.filter((p) => p.resultado);

  return (
    <div className="border-chrome mt-10 p-6">
      <h2 className="inline-flex items-center gap-2 text-xl font-bold">
        <Megaphone className="h-4 w-4 text-primary" /> MIS POSTULACIONES
      </h2>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        A qué convocatorias te anotaste y en qué quedó cada una. Las convocatorias abiertas están
        en{" "}
        <Link href="/eventos" className="underline">
          EVENTOS
        </Link>
        .
      </p>

      {error && (
        <p className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Pendientes primero: son las que todavía pueden cambiar. */}
      <div className="mt-4 flex flex-col gap-3">
        {[...pendientes, ...resueltas].map((p) => {
          const t = p.resultado ? TEXTO[p.resultado] : null;
          return (
            <div key={p.id} className="border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{p.eventTitle}</span>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                  {p.eventDate}
                </span>
              </div>
              <p className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {p.collectiveName.toUpperCase()}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] tracking-widest ${
                    p.resultado === "aceptada"
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {t ? t.rotulo : "ESPERANDO RESPUESTA"}
                </span>
                {/**
                 * Y SE DICE CUANDO LA CONVOCATORIA YA CERRÓ con la postulación sin responder.
                 * Es el estado en el que el barrido todavía no pasó: sin esta línea el DJ vería
                 * "esperando respuesta" para siempre sin saber que ya no va a llegar.
                 */}
                {!p.resultado && !p.convocatoriaAbierta && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    la convocatoria cerró sin responderte
                  </span>
                )}
              </div>

              {t && <p className="mt-1 text-sm text-muted-foreground">{t.dice}</p>}
              {p.motivo && (
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">Lo que te dejaron escrito: </span>
                  {p.motivo}
                </p>
              )}
              {/**
               * LAS DOS FECHAS DE UNA CANCELADA, que es para lo que existen separadas:
               * resueltaEn dice cuándo te aceptaron y canceladaEn cuándo lo deshicieron. Con una
               * sola columna no se podría decir cuánto tiempo estuvo programado.
               */}
              {p.resultado === "cancelada" && p.resueltaEn && p.canceladaEn && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  aceptada el {p.resueltaEn.slice(0, 10)} · cancelada el{" "}
                  {p.canceladaEn.slice(0, 10)}
                </p>
              )}

              <p className="mt-2 text-sm text-muted-foreground">
                Tu mensaje: {p.mensaje}
              </p>

              {!p.resultado && p.convocatoriaAbierta && (
                <button
                  type="button"
                  onClick={() => retirar(p.id)}
                  disabled={busy === p.id}
                  className="mt-2 min-h-[44px] w-full border border-border px-3 font-mono text-[10px] tracking-[0.2em] hover:bg-muted disabled:opacity-50 sm:w-auto"
                >
                  {busy === p.id ? "RETIRANDO..." : "RETIRAR MI POSTULACIÓN"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
