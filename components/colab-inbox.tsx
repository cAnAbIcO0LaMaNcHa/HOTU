"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Disc3 } from "lucide-react";
import type { InvitacionColab } from "@/lib/db";

/**
 * INVITACIONES A COLABORAR, en el perfil propio (§6.1).
 *
 * Acá se entera el invitado. Sin esta bandeja, la invitación existiría en
 * la base y nadie la vería nunca: el autor esperaría una respuesta que no
 * va a llegar, y la pieza no aparecería en la casa del invitado sin que
 * nadie entienda por qué.
 *
 * Vacía no se renderiza, la regla de siempre.
 *
 * DICE A DÓNDE VA A QUEDAR FIJA ANTES DE ACEPTAR. Aceptar congela el
 * destino con la casa que el invitado tiene HOY, y eso no se deshace
 * después: rechazar más tarde retira el crédito pero no saca la pieza de
 * donde ya se publicó. Que la decisión sea irreversible obliga a que sea
 * informada.
 */
export function ColabInbox({ invitaciones }: { invitaciones: InvitacionColab[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invitaciones.length === 0) return null;

  async function responder(id: number, action: "accept" | "decline") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/collaborations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo responder (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo responder. Revisá la conexión.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-16">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <Disc3 className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
          INVITACIONES A COLABORAR
        </h2>
      </div>

      {error && <p className="mt-4 font-mono text-[10px] text-red-400">{error}</p>}

      <div className="mt-6 space-y-3">
        {invitaciones.map((inv) => (
          <div key={inv.id} className="border border-border p-4">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
              {inv.tipo === "set" ? "SET" : "TRACK"}
            </div>
            <div className="mt-1 font-bold">{inv.piezaTitulo}</div>
            {/* A cuál de tus colectivos invitaron. Sin esto, un dueño de
                varios no sabe cuál está respondiendo. */}
            {inv.colectivoNombre && (
              <div className="mt-1 font-mono text-[10px] tracking-widest text-primary">
                INVITARON A {inv.colectivoNombre.toUpperCase()}
              </div>
            )}
            <div className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">
              de{" "}
              {inv.autorSlug ? (
                <Link href={`/artistas/${inv.autorSlug}`} className="hover:text-primary">
                  {inv.autorNombre}
                </Link>
              ) : (
                inv.autorNombre
              )}
            </div>

            <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {inv.destino ? (
                <>
                  Si aceptás, esta pieza va a aparecer en{" "}
                  <strong className="text-primary">{inv.destino}</strong> y se queda ahí: las
                  piezas con colaboradores no se mudan, aunque después cambies de casa.
                </>
              ) : (
                <>
                  <strong className="text-primary">Todavía no tenés una casa</strong>, así que
                  aceptar no va a hacer que la pieza aparezca en ningún colectivo — ni ahora ni
                  cuando entres a uno. El crédito sí queda. Si querés que aparezca, entrá a un
                  colectivo antes de aceptar.
                </>
              )}
            </p>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={busy === inv.id}
                onClick={() => responder(inv.id, "accept")}
                className="surface-chrome sheen px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
              >
                ACEPTAR
              </button>
              <button
                type="button"
                disabled={busy === inv.id}
                onClick={() => responder(inv.id, "decline")}
                className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              >
                RECHAZAR
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
