"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Home, Users } from "lucide-react";
import type { MyMembership, PendingMembership } from "@/lib/db";

/**
 * The DJ's side of the membership conversation, on their profile.
 *
 * Two kinds of row land here and they are not the same thing:
 *   - a collective invited them  -> theirs to answer, with the kind
 *   - they applied somewhere     -> waiting, nothing to click
 *
 * Accepting is where the DJ chooses casa or residente, because that choice
 * is theirs alone (§3). Picking "casa" while already having one runs the
 * change-of-home flow server-side: the old home is demoted to residente
 * and the new one takes over, in one transaction, so there is never a
 * moment with two casas.
 */
export function MembershipInbox({
  pending,
  memberships,
  currentCasa,
}: {
  pending: PendingMembership[];
  /** Accepted, live links — where the casa/residente choice happens. */
  memberships: MyMembership[];
  /** The collective that is currently home, if any — so the warning about
   *  replacing it can name it instead of being abstract. */
  currentCasa: { slug: string; name: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The open home conflict, if any: the server handed back options instead
   * of acting, and nothing changes until one of them is clicked.
   */
  const [conflict, setConflict] = useState<{
    id: number;
    current: { slug: string; name: string };
    target: { slug: string; name: string };
  } | null>(null);

  if (pending.length === 0 && memberships.length === 0) return null;

  async function act(id: number, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/memberships/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo responder (HTTP ${res.status})`);
        return;
      }
      // A conflict is a question, not a failure: the row is untouched and
      // the DJ has to answer it before anything moves.
      if (data.conflict === "casa") {
        setConflict({ id, current: data.current, target: data.target });
        return;
      }
      setConflict(null);
      router.refresh();
    } catch {
      setError("No se pudo responder. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  const invitations = pending.filter((p) => p.requestedBy === "collective");
  const applications = pending.filter((p) => p.requestedBy === "artist");

  return (
    <div className="border-chrome mt-10 p-6">
      <h2 className="inline-flex items-center gap-2 text-xl font-bold">
        <Clock className="h-4 w-4 text-primary" /> COLECTIVOS
      </h2>

      {/* The three options, spelled out. Nothing was closed to get here. */}
      {conflict && (
        <div className="mt-5 border border-primary p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-primary">
            ELEGÍ DÓNDE QUEDA TU CASA
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed">
            Hoy tu casa es <strong>{conflict.current.name}</strong>. Querés hacer tu casa en{" "}
            <strong>{conflict.target.name}</strong>. Un DJ tiene una sola casa, así que hay
            que decidir qué pasa con {conflict.current.name}.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            {[
              {
                key: "keep",
                body: { action: "casa", decision: "keep" },
                titulo: `Mi casa sigue siendo ${conflict.current.name}`,
                aqui: `Entro a ${conflict.target.name} como residente.`,
                alla: `${conflict.current.name} no cambia: sigue siendo mi casa.`,
                fuerte: false,
              },
              {
                key: "move-stay",
                body: { action: "casa", decision: "move", previous: "stay" },
                titulo: `Mi casa pasa a ser ${conflict.target.name}`,
                aqui: `${conflict.target.name} queda como mi casa.`,
                alla: `Sigo en ${conflict.current.name}, pero como residente. No pierdo el vínculo.`,
                fuerte: true,
              },
              {
                key: "move-leave",
                body: { action: "casa", decision: "move", previous: "leave" },
                titulo: `Mi casa pasa a ser ${conflict.target.name} y salgo de ${conflict.current.name}`,
                aqui: `${conflict.target.name} queda como mi casa.`,
                alla: `Se cierra del todo mi vínculo con ${conflict.current.name}. Dejo de aparecer entre sus artistas.`,
                fuerte: false,
              },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => act(conflict.id, o.body)}
                disabled={busy}
                className={`border p-3 text-left disabled:opacity-50 ${
                  o.fuerte
                    ? "border-primary text-primary"
                    : "border-border hover:border-primary"
                }`}
              >
                <span className="block font-mono text-[11px] font-bold">{o.titulo}</span>
                {/* Both halves spelled out: what happens here, and what
                    happens to the home being left behind. */}
                <span className="mt-1.5 block font-mono text-[10px] leading-relaxed text-muted-foreground">
                  · {o.aqui}
                </span>
                <span className="block font-mono text-[10px] leading-relaxed text-muted-foreground">
                  · {o.alla}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setConflict(null)}
            disabled={busy}
            className="mt-3 font-mono text-[10px] tracking-[0.15em] text-muted-foreground underline hover:text-primary disabled:opacity-50"
          >
            DEJARLO COMO ESTÁ
          </button>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            Todavía no se cambió nada.
          </p>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="mt-5">
          <span className="font-mono text-[10px] tracking-[0.2em] text-primary">
            TE INVITARON ({invitations.length})
          </span>
          <ul className="mt-3 space-y-4">
            {invitations.map((p) => (
              <li key={p.id} className="border border-border p-4">
                <Link
                  href={`/colectivos`}
                  className="font-bold hover:text-primary"
                >
                  {p.collectiveName}
                </Link>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  Te invitó a sumarte. Vos elegís cómo entrar.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => act(p.id, { action: "accept", kind: "residente" })}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 border border-primary px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-primary disabled:opacity-50"
                  >
                    <Users className="h-3 w-3" /> ENTRAR COMO RESIDENTE
                  </button>
                  <button
                    type="button"
                    onClick={() => act(p.id, { action: "accept", kind: "casa" })}
                    disabled={busy}
                    className="surface-chrome sheen inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
                  >
                    <Home className="h-3 w-3" /> HACER MI CASA
                  </button>
                  <button
                    type="button"
                    onClick={() => act(p.id, { action: "reject" })}
                    disabled={busy}
                    className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary disabled:opacity-50"
                  >
                    NO, GRACIAS
                  </button>
                </div>

                {currentCasa && (
                  <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Hoy tu casa es <strong>{currentCasa.name}</strong>. Si hacés tu casa acá,
                    allá pasás a residente — no te vas, cambiás de vínculo.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {applications.length > 0 && (
        <div className="mt-6">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            TE POSTULASTE ({applications.length})
          </span>
          <ul className="mt-2 space-y-2">
            {applications.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {p.collectiveName} · esperando respuesta
                </span>
                {/* Withdrawing is the applicant's own call, and only while
                    nobody has answered yet. */}
                <button
                  type="button"
                  onClick={() => act(p.id, { action: "cancel" })}
                  disabled={busy}
                  className="shrink-0 border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground hover:border-primary disabled:opacity-50"
                >
                  RETIRAR
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {memberships.length > 0 && (
        <div className="mt-6 border-t border-border pt-5">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            SOS PARTE DE ({memberships.length})
          </span>
          <ul className="mt-3 space-y-3">
            {memberships.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-border p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold">{m.collectiveName}</span>
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    {m.kind === "casa" ? "TU CASA" : "RESIDENTE"}
                    {m.entityKind === "venue" ? " · VENUE" : ""} · desde{" "}
                    {m.fromDate.slice(0, 10)}
                  </span>
                </span>

                {/* The choice lives here because the spec puts it AFTER the
                    other side accepts — at which point the row is no longer
                    pending and would otherwise have nowhere to be made.

                    En un venue no se ofrece: un venue no es la casa de
                    nadie. El write path lo rechaza igual, pero un botón que
                    siempre falla al tocarlo es peor que no tenerlo. */}
                {m.entityKind === "venue" ? (
                  <span className="shrink-0 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Acá sos residente.
                    <br />
                    Tu casa va en un colectivo.
                  </span>
                ) : m.kind === "casa" ? (
                  <button
                    type="button"
                    onClick={() => act(m.id, { action: "kind", kind: "residente" })}
                    disabled={busy}
                    className="shrink-0 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary disabled:opacity-50"
                  >
                    DEJAR DE SER MI CASA
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => act(m.id, { action: "kind", kind: "casa" })}
                    disabled={busy}
                    className="inline-flex shrink-0 items-center gap-1.5 border border-primary px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-primary disabled:opacity-50"
                  >
                    <Home className="h-3 w-3" /> HACER MI CASA
                  </button>
                )}
              </li>
            ))}
          </ul>
          {currentCasa &&
            memberships.some((m) => m.kind !== "casa" && m.entityKind !== "venue") && (
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Hacer tu casa en otro lado mueve la de <strong>{currentCasa.name}</strong>, que
              pasa a residente. Nunca tenés dos casas.
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
