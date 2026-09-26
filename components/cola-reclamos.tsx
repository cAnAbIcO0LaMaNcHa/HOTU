"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ShieldQuestion, X } from "lucide-react";
import type { ReclamoPendiente } from "@/lib/claims-write";

/**
 * LA COLA DE RECLAMOS (§8 pieza 2).
 *
 * ============================================================
 * LO QUE ESTA PANTALLA TIENE QUE MOSTRAR, Y POR QUÉ
 * ============================================================
 *
 * Aprobar un reclamo le entrega un perfil a alguien basándose en lo que
 * ese alguien escribió. No hay verificación automática posible: el correo
 * del perfil no existe y el patrón `<slug>@dominio` es deducible desde la
 * URL, así que conocerlo no prueba nada.
 *
 * Entonces lo único que decide es el juicio de una persona, y esta
 * pantalla existe para darle con qué: el texto completo del reclamo, el
 * perfil al que apunta, hace cuánto espera, y CÓMO SE REGISTRÓ quien
 * reclama.
 *
 * ============================================================
 * EL PROVEEDOR ES UNA SEÑAL, NO UNA PRUEBA
 * ============================================================
 *
 * 'google' significa que Google verificó ese correo. 'credentials'
 * significa que NADIE lo verificó, porque HOTU todavía no tiene transporte
 * de mail para mandar una verificación.
 *
 * Se muestra con esas palabras y no como un tilde verde, justamente para
 * que no se lea como "ya está comprobado". Un correo verificado por Google
 * prueba que esa persona controla ese correo; no prueba que sea el DJ del
 * perfil. Eso lo sigue decidiendo el moderador.
 */
export function ColaReclamos({ reclamos }: { reclamos: ReclamoPendiente[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motivos, setMotivos] = useState<Record<number, string>>({});

  const responder = async (id: number, accion: "aprobar" | "rechazar") => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, motivo: motivos[id] ?? "" }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error ?? `Error ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (reclamos.length === 0) {
    return (
      <p className="mt-6 font-mono text-[11px] text-muted-foreground">
        No hay reclamos esperando.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      {error && (
        <p className="border border-red-500/50 bg-red-500/5 px-4 py-3 font-mono text-[11px] text-red-400">
          {error}
        </p>
      )}

      {reclamos.map((r) => {
        const motivo = motivos[r.id] ?? "";
        const puedeRechazar = motivo.trim().length >= 10;
        const trabajando = busy === r.id;

        return (
          <div key={r.id} className="border border-border p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                #{r.id}
              </span>
              <Link
                href={r.tipo === "artist" ? `/artistas/${r.slug}` : `/colectivos/${r.slug}`}
                className="text-sm font-bold text-primary hover:underline"
              >
                {r.nombre}
              </Link>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {r.tipo === "artist" ? "PERFIL DE DJ" : "COLECTIVO"} · {r.slug}
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                espera {r.dias} día(s)
              </span>
            </div>

            <p className="mt-3 font-mono text-[11px] text-muted-foreground">
              Lo pide <strong className="text-foreground">{r.reclamante}</strong>
            </p>

            {/* La señal, con palabras y no con un tilde. */}
            <p className="mt-1 flex items-center gap-2 font-mono text-[10px] leading-relaxed">
              <ShieldQuestion className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {r.correoVerificado ? (
                <span className="text-muted-foreground">
                  Se registró con <strong className="text-foreground">Google</strong>, así que
                  Google verificó ese correo. Eso prueba que controla la dirección, no que sea
                  quien dice ser.
                </span>
              ) : (
                <span className="text-amber-400">
                  Se registró con <strong>email y contraseña</strong>: ese correo{" "}
                  <strong>no está verificado</strong> por nadie. HOTU todavía no tiene transporte
                  de mail para verificarlo.
                </span>
              )}
            </p>

            <div className="mt-3 border-l-2 border-border pl-3">
              <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                LO QUE ESCRIBIÓ
              </p>
              <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                {r.nota}
              </p>
            </div>

            <label className="mt-4 block">
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                MOTIVO — obligatorio para rechazar, opcional para aprobar
              </span>
              <textarea
                value={motivo}
                disabled={trabajando}
                rows={2}
                onChange={(e) => setMotivos((m) => ({ ...m, [r.id]: e.target.value }))}
                placeholder="Qué le falta, o con qué lo comprobaste"
                className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-primary"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={trabajando}
                onClick={() => responder(r.id, "aprobar")}
                className="flex items-center gap-2 border border-primary px-4 py-2 font-mono text-[11px] tracking-widest text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <Check className="h-4 w-4" /> {trabajando ? "..." : "ENTREGARLE EL PERFIL"}
              </button>
              <button
                type="button"
                disabled={trabajando || !puedeRechazar}
                onClick={() => responder(r.id, "rechazar")}
                className="flex items-center gap-2 border border-red-500/60 px-4 py-2 font-mono text-[11px] tracking-widest text-red-400 hover:bg-red-500/10 disabled:opacity-40"
              >
                <X className="h-4 w-4" /> RECHAZAR
              </button>
              {!puedeRechazar && (
                <span className="self-center font-mono text-[10px] text-muted-foreground">
                  Para rechazar hace falta el motivo: es lo único que recibe.
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
