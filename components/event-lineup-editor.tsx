"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import type { LineupEntry } from "@/lib/db";

/**
 * Resolver el lineup de un evento a mano, en el admin (§7).
 *
 * ============================================================
 * EL TEXTO DEL FLYER VA AL LADO, NO REEMPLAZADO
 * ============================================================
 *
 * Cada fila muestra `raw_name` —lo que decía el flyer, verbatim— y al
 * lado a quién se resolvió. Sin el texto original, resolver "HOTU Crew"
 * sería adivinar de memoria; con el texto al lado es una decisión
 * informada, que es toda la diferencia entre revisar y rehacer.
 *
 * El import ya hizo lo que podía hacer sin adivinar: los matcheos
 * exactos. Lo que queda acá es exactamente lo que una máquina no puede
 * decidir — "HOTU Crew" no corresponde a nadie, y si corresponde a
 * alguien lo sabe una persona, no un algoritmo de distancia de strings.
 *
 * SE PUEDE DEJAR SIN RESOLVER. Un nombre puede no corresponder a nadie
 * para siempre: un invitado que no tiene perfil, una crew que se
 * disolvió. "Sin resolver" es un estado final legítimo, no un pendiente
 * eterno, y por eso se puede marcar el lineup como revisado igual.
 */
export function EventLineupEditor({
  eventId,
  entries,
  /** El texto congelado de events.lineup, para comparar. */
  lineupTexto,
  candidatos,
  revisadoEn,
}: {
  eventId: number;
  entries: LineupEntry[];
  lineupTexto: string;
  candidatos: Array<{ slug: string; name: string; kind: "artist" | "collective" }>;
  revisadoEn: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [valores, setValores] = useState<string[]>(
    entries.map((e) =>
      e.artistSlug ? `artist:${e.artistSlug}` : e.collectiveSlug ? `collective:${e.collectiveSlug}` : ""
    )
  );

  const sinResolver = valores.filter((v) => v === "").length;

  async function guardar(marcarRevisado: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/lineup`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: entries.map((e, i) => {
            const [kind, slug] = valores[i] ? valores[i].split(":") : ["", ""];
            return {
              rawName: e.rawName,
              artistSlug: kind === "artist" ? slug : null,
              collectiveSlug: kind === "collective" ? slug : null,
            };
          }),
          marcarRevisado,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo guardar (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="mt-4 border border-dashed border-border p-4">
        <div className={"font-mono text-[10px] tracking-widest text-muted-foreground"}>
          LINE-UP SIN IMPORTAR
        </div>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Este evento todavía no tiene lineup relacionado. Corré{" "}
          <code>/api/setup-event-lineup?secret=…&amp;import=1</code> para traerlo del texto, o
          editá el LINE-UP de arriba y volvé a importar.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-widest text-primary">
          LINE-UP RELACIONADO ({entries.length})
        </span>
        {revisadoEn ? (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-widest text-muted-foreground">
            <Check className="h-3 w-3" /> REVISADO
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-widest text-amber-500">
            <AlertTriangle className="h-3 w-3" /> SIN REVISAR
          </span>
        )}
      </div>

      {/* El texto del flyer, congelado, como referencia. No es editable
          acá: se edita arriba, en el campo LINE-UP. */}
      <p className="mt-3 border-l-2 border-border pl-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Flyer: <span className="text-foreground/70">{lineupTexto}</span>
      </p>

      <div className="mt-4 space-y-2">
        {entries.map((e, i) => (
          <div key={`${e.rawName}-${i}`} className="flex flex-wrap items-center gap-2">
            <span className="w-40 shrink-0 truncate font-mono text-[11px]">{e.rawName}</span>
            <select
              value={valores[i]}
              disabled={busy}
              onChange={(ev) =>
                setValores((v) => v.map((x, j) => (j === i ? ev.target.value : x)))
              }
              className="min-w-[200px] flex-1 border border-border bg-background px-2 py-1 font-mono text-[11px] hover:border-primary focus:border-primary focus:outline-none"
            >
              <option value="">— sin resolver —</option>
              {candidatos.map((c) => (
                <option key={`${c.kind}:${c.slug}`} value={`${c.kind}:${c.slug}`}>
                  {c.name}
                  {c.kind === "collective" ? " · colectivo" : ""}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {error && <p className="mt-3 font-mono text-[10px] text-red-400">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => guardar(false)}
          className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {busy ? "GUARDANDO..." : "GUARDAR"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => guardar(true)}
          className="surface-chrome sheen px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
        >
          GUARDAR Y MARCAR REVISADO
        </button>
        {sinResolver > 0 && (
          // Dice el número pero NO bloquea: un nombre puede no
          // corresponder a nadie para siempre, y exigir resolverlo todo
          // dejaría este evento "sin revisar" eternamente por un invitado
          // que nunca tuvo perfil.
          <span className="self-center font-mono text-[10px] text-muted-foreground">
            {sinResolver} sin resolver — se puede marcar revisado igual.
          </span>
        )}
      </div>
    </div>
  );
}
