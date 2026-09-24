"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2 } from "lucide-react";
import type { CesionPendiente } from "@/lib/db";

/**
 * TE OFRECIERON UN COLECTIVO (§8 A).
 *
 * ============================================================
 * ACÁ SE ENTERA EL RECEPTOR, Y ES EL ÚNICO LUGAR
 * ============================================================
 *
 * Sin esta bandeja la cesión existiría en la base y nadie la vería: quien
 * cedió ya se desprendió del colectivo, y el que lo recibe no sabría que
 * le ofrecieron nada. El colectivo se quedaría desamparado para siempre
 * por una invitación que nunca llegó a destino.
 *
 * ============================================================
 * DICE CON QUÉ VIENE, ANTES DE ACEPTAR
 * ============================================================
 *
 * Aceptar es asumir la administración de un colectivo con su gente, sus
 * eventos y sus noticias. Cuántos hay de cada cosa es justo lo que hace
 * distinta una decisión de dos segundos de una informada.
 *
 * Y dice qué pasa si NO aceptás, que es lo que nadie adivina: el
 * colectivo no vuelve a quien lo cedió, se queda sin dueño.
 */
export function CesionInbox({ cesiones }: { cesiones: CesionPendiente[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (cesiones.length === 0) return null;

  async function responder(id: number, action: "accept" | "decline") {
    if (
      action === "decline" &&
      !confirm(
        "Si lo rechazás, el colectivo NO vuelve a quien te lo ofreció: se queda sin dueño hasta que alguien lo reclame. Nada de lo publicado se borra."
      )
    ) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/ownership/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo. Revisá la conexión.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-16">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <Building2 className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
          TE OFRECIERON LA ADMINISTRACIÓN
        </h2>
      </div>

      {error && (
        <p role="alert" className="mt-4 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {cesiones.map((c) => (
          <div key={c.id} className="border border-border p-4">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
              {c.esVenue ? "VENUE" : "COLECTIVO"}
            </div>
            <div className="mt-1 font-bold">
              <Link
                href={`${c.esVenue ? "/venues" : "/colectivos"}/${c.collectiveSlug}`}
                className="hover:text-primary"
              >
                {c.collectiveName}
              </Link>
            </div>
            {c.deQuien && (
              <div className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                DE {c.deQuien}
              </div>
            )}

            {/* Con qué viene. Aceptar es asumir todo esto. */}
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              Si aceptás vas a administrar {c.collectiveName}: {c.miembros}{" "}
              {c.miembros === 1 ? "miembro" : "miembros"}, {c.eventos}{" "}
              {c.eventos === 1 ? "evento" : "eventos"} y {c.noticias}{" "}
              {c.noticias === 1 ? "noticia" : "noticias"}. Podés publicar a su nombre,
              editar su info y responder sus solicitudes.
            </p>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Si no aceptás, <strong className="text-primary">no vuelve a quien te lo
              ofreció</strong>: se queda sin dueño hasta que alguien lo reclame. Nada de
              lo que publicó se borra en ningún caso.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === c.id}
                onClick={() => responder(c.id, "accept")}
                className="surface-chrome sheen px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
              >
                {busy === c.id ? "..." : "ACEPTAR"}
              </button>
              <button
                type="button"
                disabled={busy === c.id}
                onClick={() => responder(c.id, "decline")}
                className="border border-border px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
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
