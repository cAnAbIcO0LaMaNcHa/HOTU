"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";

type Candidato = {
  email: string;
  artistSlug: string;
  artistName: string;
  kind: "casa" | "residente";
  yaAdministra: number;
};

/**
 * CEDER LA ADMINISTRACIÓN del colectivo a otro de sus miembros (§8 A).
 *
 * ============================================================
 * LA LISTA SE PIDE AL ABRIR, NO AL CARGAR EL PANEL
 * ============================================================
 *
 * El panel puede tener dos colectivos y casi nadie va a ceder ninguno.
 * Traer los candidatos de los dos en cada visita es pagar una consulta
 * por algo que se usa una vez en la vida del colectivo.
 *
 * ============================================================
 * DICE QUÉ PASA Y QUÉ NO, PORQUE ES IRREVERSIBLE PARA VOS
 * ============================================================
 *
 * Después de ceder no lo podés recuperar por tu cuenta: quien decide es
 * el dueño nuevo. Eso se dice antes, no en un aviso después del click.
 */
export function CederColectivo({
  slug,
  nombre,
  palabra = "colectivo",
}: {
  slug: string;
  nombre: string;
  palabra?: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [elegido, setElegido] = useState("");

  async function abrir() {
    setAbierto(true);
    setError(null);
    if (candidatos) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/collectives/${encodeURIComponent(slug)}/owner`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return;
      }
      setCandidatos(d.candidatos ?? []);
    } catch {
      setError("No se pudo. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  async function ceder() {
    const quien = candidatos?.find((c) => c.email === elegido);
    if (!quien) return;
    if (
      !confirm(
        `Cederle ${nombre} a ${quien.artistName}.\n\n` +
          `A partir de ahí no vas a poder publicar ni editar como ${nombre}, y no lo podés ` +
          `recuperar por tu cuenta: va a depender de quien lo reciba.\n\n` +
          `Nada se borra y seguís siendo miembro.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/collectives/${encodeURIComponent(slug)}/owner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: elegido }),
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

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-primary"
      >
        <ArrowRightLeft className="h-3 w-3" /> CEDER LA ADMINISTRACIÓN
      </button>
    );
  }

  return (
    <div className="mt-4 border border-border p-4">
      <p className="font-mono text-[10px] tracking-[0.3em] text-primary">
        CEDER LA ADMINISTRACIÓN
      </p>

      <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Le pasás {nombre} a otro de sus miembros. El {palabra} y todo lo que publicó
        se quedan como están; lo único que cambia es quién lo administra.
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Vos seguís siendo miembro, pero dejás de poder publicar y editar como él, y{" "}
        <strong className="text-primary">no lo vas a poder recuperar por tu cuenta</strong>.
        Eso sí, te libera el cupo para fundar otro.
      </p>

      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      {busy && !candidatos && (
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">Buscando...</p>
      )}

      {candidatos && candidatos.length === 0 && (
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          No hay a quién cedérselo: solo se le puede ceder a un miembro del {palabra} que
          tenga cuenta en HOTU. Si va a ser de alguien de afuera, escribile al equipo.
        </p>
      )}

      {candidatos && candidatos.length > 0 && (
        <>
          <label className="mt-4 block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              A QUIÉN
            </span>
            <select
              value={elegido}
              disabled={busy}
              onChange={(e) => setElegido(e.target.value)}
              className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            >
              <option value="">— elegí a alguien —</option>
              {candidatos.map((c) => (
                <option key={c.email} value={c.email}>
                  {c.artistName} — {c.kind === "casa" ? "de la casa" : "residente"}
                  {/* Que ya administre otro NO lo impide: el límite de uno
                      por cuenta es para fundar, no para recibir. Pero se
                      dice, porque es información para decidir. */}
                  {c.yaAdministra > 0 ? ` (ya administra ${c.yaAdministra})` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || elegido === ""}
              onClick={ceder}
              className="surface-chrome sheen px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-40"
            >
              {busy ? "CEDIENDO..." : "CEDER"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAbierto(false)}
              className="px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-primary disabled:opacity-50"
            >
              CANCELAR
            </button>
          </div>
        </>
      )}

      {!candidatos && !busy && (
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="mt-4 px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-primary"
        >
          CANCELAR
        </button>
      )}
    </div>
  );
}
