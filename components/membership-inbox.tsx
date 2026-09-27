"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Home, Users } from "lucide-react";
import type { MyMembership, PendingMembership } from "@/lib/db";

/**
 * El lado del DJ de la conversación de membresía, en su perfil.
 *
 * Tres cosas distintas caen acá:
 *   - un colectivo lo invitó       -> le toca responder
 *   - él se postuló                -> esperando, nada que apretar
 *   - le OFRECIERON LA RESIDENCIA  -> le toca responder, y es otra cosa
 *
 * ============================================================
 * LO QUE ESTE COMPONENTE YA NO TIENE: EL BOTÓN "HACER MI CASA"
 * ============================================================
 *
 * Hasta §8 fase 2, aceptar era donde el DJ elegía casa o miembro, y había un
 * botón para volver casa cualquier vínculo ya aceptado. Los dos se fueron.
 *
 * 'residente' ahora es PERMISO PARA EDITAR el colectivo, y un permiso no se
 * toma: lo ofrece quien administra el colectivo y el DJ lo acepta. Dejar el
 * botón habría sido dejar que cualquier miembro se diera permiso de editar un
 * perfil ajeno con un clic.
 *
 * Lo que SÍ queda es el botón para DEJAR de ser residente, y queda sin pedirle
 * permiso a nadie: renunciar a un permiso es asunto de quien lo tiene.
 */
export function MembershipInbox({
  pending,
  memberships,
  residenciaActual,
  ofertas,
}: {
  pending: PendingMembership[];
  /** Vínculos aceptados y vivos. Acá solo se puede RENUNCIAR a la residencia. */
  memberships: MyMembership[];
  /** El colectivo donde hoy es residente, si hay alguno — para que los avisos
   *  lo nombren en vez de hablar en abstracto. */
  residenciaActual: { slug: string; name: string } | null;
  /** Ofertas de residencia sin responder. */
  ofertas: {
    id: number;
    collectiveSlug: string;
    collectiveName: string;
    offeredAt: string;
  }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * El conflicto de residencia abierto, si hay: el servidor devolvió las
   * opciones en vez de actuar, y nada cambia hasta que se elija una.
   */
  const [conflict, setConflict] = useState<{
    id: number;
    actual: { slug: string; name: string };
    destino: { slug: string; name: string };
  } | null>(null);

  if (pending.length === 0 && memberships.length === 0 && ofertas.length === 0) return null;

  async function pedir(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo responder (HTTP ${res.status})`);
        return;
      }
      /**
       * Un conflicto es una PREGUNTA, no un error: la fila quedó intacta y el
       * DJ tiene que contestarla antes de que algo se mueva.
       */
      if (data.conflict === "residencia") {
        setConflict({ id: data.id ?? conflict?.id ?? 0, actual: data.actual, destino: data.destino });
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

  const act = (id: number, body: Record<string, unknown>) =>
    pedir(`/api/memberships/${id}`, body);
  const responderOferta = (id: number, body: Record<string, unknown>) =>
    pedir(`/api/residency-offers/${id}`, body);

  const invitations = pending.filter((p) => p.requestedBy === "collective");
  const applications = pending.filter((p) => p.requestedBy === "artist");

  return (
    <div className="border-chrome mt-10 p-6">
      <h2 className="inline-flex items-center gap-2 text-xl font-bold">
        <Clock className="h-4 w-4 text-primary" /> COLECTIVOS
      </h2>

      {/* Las opciones, dichas enteras. Para llegar acá no se cerró nada. */}
      {conflict && (
        <div className="mt-5 border border-primary p-5">
          <span className="font-mono text-[10px] tracking-[0.2em] text-primary">
            TENÉS QUE ELEGIR
          </span>
          <p className="mt-2 font-mono text-[11px] leading-relaxed">
            Hoy sos residente de <strong>{conflict.actual.name}</strong>, y{" "}
            <strong>{conflict.destino.name}</strong> te ofreció su residencia. Un DJ es residente
            de un solo colectivo, así que hay que decidir qué pasa con {conflict.actual.name}.
          </p>

          <div className="mt-4 space-y-2">
            {[
              {
                body: {
                  action: "aceptar",
                  decision: { respuesta: "renunciar", anterior: "miembro" },
                },
                titulo: `Paso a ser residente de ${conflict.destino.name}`,
                aqui: `${conflict.destino.name} queda como mi residencia.`,
                alla: `Sigo en ${conflict.actual.name}, pero como miembro. No pierdo el vínculo.`,
              },
              {
                body: {
                  action: "aceptar",
                  decision: { respuesta: "renunciar", anterior: "salir" },
                },
                titulo: `Paso a ${conflict.destino.name} y salgo de ${conflict.actual.name}`,
                aqui: `${conflict.destino.name} queda como mi residencia.`,
                alla: `Se cierra del todo mi vínculo con ${conflict.actual.name}. Dejo de aparecer entre sus artistas.`,
              },
              {
                body: { action: "aceptar", decision: { respuesta: "rechazar" } },
                titulo: `Sigo siendo residente de ${conflict.actual.name}`,
                aqui: `Rechazo la oferta de ${conflict.destino.name}.`,
                alla: `${conflict.actual.name} no cambia.`,
              },
            ].map((o) => (
              <button
                key={o.titulo}
                type="button"
                onClick={() => responderOferta(conflict.id, o.body)}
                disabled={busy}
                className="block w-full border border-border p-3 text-left hover:border-primary disabled:opacity-50"
              >
                <span className="block font-mono text-[11px] font-bold">{o.titulo}</span>
                {/* Las dos consecuencias, siempre las dos: qué pasa acá y qué
                    pasa con la residencia que se deja atrás. */}
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

      {/* LAS OFERTAS DE RESIDENCIA, primero: es lo único acá que otorga un
          permiso, y por eso se dice qué permiso es. */}
      {ofertas.length > 0 && (
        <div className="mt-5">
          <span className="font-mono text-[10px] tracking-[0.2em] text-primary">
            TE OFRECIERON LA RESIDENCIA ({ofertas.length})
          </span>
          <ul className="mt-3 space-y-4">
            {ofertas.map((o) => (
              <li key={o.id} className="border border-primary p-4">
                <span className="font-bold">{o.collectiveName}</span>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  Si aceptás, quedás como residente: aparecés entre sus RESIDENTES y podés
                  editar el perfil del colectivo —eventos, noticias, géneros, fotos—. No podés
                  invitar ni sacar gente, ni ver sus ventas.
                </p>
                {residenciaActual && (
                  <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Hoy sos residente de <strong>{residenciaActual.name}</strong>. Aceptar te va a
                    preguntar qué querés que pase con eso — no se mueve solo.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => responderOferta(o.id, { action: "aceptar" })}
                    disabled={busy}
                    className="surface-chrome sheen inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
                  >
                    <Home className="h-3 w-3" /> ACEPTAR LA RESIDENCIA
                  </button>
                  <button
                    type="button"
                    onClick={() => responderOferta(o.id, { action: "rechazar" })}
                    disabled={busy}
                    className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary disabled:opacity-50"
                  >
                    NO, GRACIAS
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
                <Link href={`/colectivos`} className="font-bold hover:text-primary">
                  {p.collectiveName}
                </Link>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  Te invitó a sumarte como miembro.
                </p>

                {/* UN SOLO BOTÓN DE ACEPTAR. Antes había dos —miembro o casa—
                    y esa elección ya no es del DJ: la residencia se ofrece
                    aparte, y aparece arriba cuando la ofrecen. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => act(p.id, { action: "accept" })}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 border border-primary px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-primary disabled:opacity-50"
                  >
                    <Users className="h-3 w-3" /> ENTRAR COMO MIEMBRO
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
                {/* Retirarse es decisión del que se postuló, y solo mientras
                    nadie haya contestado todavía. */}
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
                    {m.kind === "residente" ? "RESIDENTE" : "MIEMBRO"}
                    {m.entityKind === "venue" ? " · VENUE" : ""} · desde{" "}
                    {m.fromDate.slice(0, 10)}
                  </span>
                </span>

                {/* SOLO SE PUEDE BAJAR. No hay botón para subir porque subir no
                    es del DJ: se lo ofrecen. Y bajar no le pide permiso a nadie,
                    porque renunciar a un permiso es de quien lo tiene. */}
                {m.entityKind === "venue" ? (
                  <span className="shrink-0 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Acá sos miembro.
                    <br />
                    La residencia va en un colectivo.
                  </span>
                ) : m.kind === "residente" ? (
                  <button
                    type="button"
                    onClick={() => act(m.id, { action: "kind", kind: "miembro" })}
                    disabled={busy}
                    className="shrink-0 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary disabled:opacity-50"
                  >
                    DEJAR DE SER RESIDENTE
                  </button>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    Acá sos miembro.
                  </span>
                )}
              </li>
            ))}
          </ul>
          {residenciaActual && (
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Sos residente de <strong>{residenciaActual.name}</strong>. La residencia la ofrece
              el colectivo, y siempre es una sola.
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
