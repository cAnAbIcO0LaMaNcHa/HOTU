"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Clock, Eye } from "lucide-react";
import type { Faltante } from "@/lib/artists-write";

/**
 * La franja de estado sobre el press kit, para su dueño (ALTA-DJ paso 5).
 *
 * Solo la ve quien puede editar el perfil. Un visitante nunca llega acá,
 * porque un perfil sin publicar le da 404.
 *
 * No dice solamente "estás en borrador": dice QUÉ FALTA. Un DJ que no
 * sabe qué le falta no completa nada, y el perfil se queda ahí para
 * siempre.
 */
export function FranjaRevision({
  slug,
  reviewStatus,
  reviewNote,
  faltantes,
}: {
  slug: string;
  reviewStatus: "borrador" | "en_revision" | "rechazado" | "aprobado";
  reviewNote?: string;
  faltantes: Faltante[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Aprobado y publicado: no hay nada que decirle.
  if (reviewStatus === "aprobado") return null;

  const bloqueantes = faltantes.filter((f) => f.bloquea);
  const sugerencias = faltantes.filter((f) => !f.bloquea);
  const puedeEnviar = bloqueantes.length === 0;

  async function mover(action: "submit" | "withdraw") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}/review`, {
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
      setBusy(false);
    }
  }

  return (
    <div className="border-chrome mb-8 p-5">
      {/* --- en revisión ------------------------------------------- */}
      {reviewStatus === "en_revision" && (
        <>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-primary">
            <Clock className="h-3 w-3" /> EN REVISIÓN
          </p>
          <p className="mt-3 font-mono text-[11px] leading-relaxed">
            Tu perfil está esperando aprobación. Mientras tanto no se puede editar:
            quien lo revisa tiene que ver lo mismo que vos mandaste.
          </p>
          <button
            type="button"
            onClick={() => mover("withdraw")}
            disabled={busy}
            className="mt-4 border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {busy ? "RETIRANDO..." : "RETIRAR Y SEGUIR EDITANDO"}
          </button>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Vuelve a borrador y lo mandás de nuevo cuando quieras. Se puede retirar
            solo mientras nadie lo haya decidido.
          </p>
        </>
      )}

      {/* --- rechazado, con el motivo ACÁ MISMO ---------------------- */}
      {reviewStatus === "rechazado" && (
        <>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-primary">
            <AlertCircle className="h-3 w-3" /> NO SE APROBÓ TODAVÍA
          </p>
          {reviewNote && (
            <blockquote className="mt-3 border-l-2 border-primary pl-4 font-mono text-[12px] leading-relaxed">
              {reviewNote}
            </blockquote>
          )}
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            Corregí lo que dice ahí y volvé a mandarlo. No hay límite de intentos.
          </p>
        </>
      )}

      {/* --- borrador ------------------------------------------------ */}
      {reviewStatus === "borrador" && (
        <>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-primary">
            <Eye className="h-3 w-3" /> BORRADOR · SOLO LO VES VOS
          </p>
          <p className="mt-3 font-mono text-[11px] leading-relaxed">
            Tu perfil todavía no es público. Completalo y mandalo a revisión.
          </p>
        </>
      )}

      {/* --- qué falta, en borrador y en rechazado -------------------- */}
      {reviewStatus !== "en_revision" && (
        <div className="mt-5">
          {faltantes.length === 0 ? (
            <p className="inline-flex items-center gap-2 font-mono text-[11px] text-primary">
              <Check className="h-3 w-3" /> Está todo. Ya lo podés mandar.
            </p>
          ) : (
            <>
              <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                {bloqueantes.length > 0 ? "TE FALTA" : "TE RECOMENDAMOS"}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {[...bloqueantes, ...sugerencias].map((f) => (
                  <li key={f.campo} className="font-mono text-[11px] leading-relaxed">
                    <span className={f.bloquea ? "text-primary" : "text-foreground/70"}>
                      {f.bloquea ? "· " : "· "}
                      <strong>{f.campo}</strong>
                    </span>
                    <span className="block pl-3 text-muted-foreground">{f.que}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            type="button"
            onClick={() => mover("submit")}
            disabled={busy || !puedeEnviar}
            className="surface-chrome sheen mt-5 px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-40"
          >
            {busy ? "ENVIANDO..." : "ENVIAR A REVISIÓN"}
          </button>
          {!puedeEnviar && (
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              El botón se habilita cuando completes lo de arriba.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}
    </div>
  );
}
