"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Clock, UserMinus } from "lucide-react";
import type { Vinculo, PendingMembership } from "@/lib/db";

/**
 * Membership management for one collective, in the admin.
 *
 * The collective INVITES; it does not add. A membership only counts with
 * both sides agreeing, so what used to be an instant add is now a pending
 * row the DJ has to answer (tanda 3, §3). There is no kind selector here
 * LA RESIDENCIA SE OFRECE DESDE ACÁ y es lo único de esta pantalla que
 * reparte un PERMISO: un residente puede editar el perfil del colectivo.
 *
 * Everything goes through the API, per the repo rule that no component
 * writes directly.
 */
export function CollectiveMembersEditor({
  collectiveSlug,
  vinculos,
  pending,
  departures,
  artists,
  ofertas = [],
  esVenue = false,
}: {
  collectiveSlug: string;
  vinculos: Vinculo[];
  pending: PendingMembership[];
  /** §3.2 — the owner always finds out when they lose somebody. */
  departures: { artistSlug: string; artistName: string; kind: string; toDate: string }[];
  artists: { slug: string; name: string }[];
  /** Ofertas de residencia hechas y sin responder. */
  ofertas?: { id: number; artistSlug: string; artistName: string; offeredAt: string }[];
  /**
   * Un venue no tiene residentes, así que ni se ofrece ni se muestra el botón.
   * El write path lo rechaza igual, pero un botón que siempre falla al tocarlo
   * es peor que no tenerlo.
   */
  esVenue?: boolean;
}) {
  const router = useRouter();
  const [artistSlug, setArtistSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const busyWrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch {
      setError("No se pudo completar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    busyWrap(async () => {
      if (!artistSlug) return;
      const res = await fetch("/api/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectiveSlug, artistSlug, requestedBy: "collective" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo invitar (HTTP ${res.status})`);
        return;
      }
      setArtistSlug("");
      setNote("Invitación enviada. Cuenta cuando el DJ acepte.");
      router.refresh();
    });

  /** Answering an application the DJ sent us. */
  const answer = (id: number, action: "accept" | "reject" | "cancel") =>
    busyWrap(async () => {
      const res = await fetch(`/api/memberships/${id}`, {
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
    });

  const remove = (slug: string) =>
    busyWrap(async () => {
      const res = await fetch(
        `/api/collectives/${encodeURIComponent(collectiveSlug)}/vinculos/${encodeURIComponent(slug)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo quitar (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    });

  /**
   * OFRECER LA RESIDENCIA. No la otorga: deja una oferta que el DJ acepta.
   *
   * Es el único botón de esta pantalla que reparte un PERMISO, y por eso es el
   * único que no hace nada de inmediato. El aviso lo dice, porque un botón que
   * parece aplicar y en realidad pregunta es un botón que se aprieta sin leer.
   */
  const ofrecerResidencia = (slug: string, nombre: string) =>
    busyWrap(async () => {
      const res = await fetch(
        `/api/collectives/${encodeURIComponent(collectiveSlug)}/residency-offers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistSlug: slug }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo ofrecer (HTTP ${res.status})`);
        return;
      }
      setNote(`Residencia ofrecida a ${nombre}. Cuenta cuando acepte.`);
      router.refresh();
    });

  /** El dueño se arrepiente antes de que el DJ conteste. */
  const revocarOferta = (id: number) =>
    busyWrap(async () => {
      const res = await fetch(`/api/residency-offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revocar" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo revocar (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    });

  const conOfertaAbierta = new Set(ofertas.map((o) => o.artistSlug));

  const alreadyLinked = new Set([
    ...vinculos.map((m) => m.artistSlug),
    ...pending.map((p) => p.artistSlug),
  ]);

  return (
    <div className="sm:col-span-2 space-y-4 border border-border p-4">
      <div>
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          MIEMBROS ({vinculos.length})
        </span>

        {vinculos.length === 0 ? (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            Sin miembros todavía.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {vinculos.map((m) => (
              <li key={m.artistSlug} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs">
                  {m.artistName}
                  <span
                    className={`ml-2 border px-1.5 py-0.5 text-[9px] tracking-widest ${
                      m.kind === "residente"
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {m.kind === "residente" ? "RESIDENTE" : "MIEMBRO"}
                  </span>
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    desde {m.fromDate.slice(0, 10)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {/* OFRECER LA RESIDENCIA: solo a quien todavía no la tiene, y
                      nunca en un venue. Si ya hay una oferta sin responder, se
                      dice eso en vez de ofrecer de nuevo — el índice único lo
                      rechazaría con un 409 que no explica nada. */}
                  {!esVenue && m.kind !== "residente" && (
                    conOfertaAbierta.has(m.artistSlug) ? (
                      <span className="font-mono text-[9px] tracking-widest text-muted-foreground">
                        RESIDENCIA OFRECIDA
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => ofrecerResidencia(m.artistSlug, m.artistName)}
                        disabled={busy}
                        className="font-mono text-[9px] tracking-widest text-primary underline hover:no-underline disabled:opacity-50"
                      >
                        OFRECER RESIDENCIA
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => remove(m.artistSlug)}
                    disabled={busy}
                    className="text-muted-foreground hover:text-primary disabled:opacity-50"
                    aria-label={`Quitar a ${m.artistName}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* RESIDENCIAS OFRECIDAS Y SIN RESPONDER. Van en su propio bloque y no
          como una etiqueta al lado del nombre, porque una oferta sin responder
          no es un estado del miembro: es una conversación abierta, y el dueño
          tiene que poder retirarla. */}
      {ofertas.length > 0 && (
        <div className="border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-primary">
            <Clock className="h-3 w-3" /> RESIDENCIAS OFRECIDAS ({ofertas.length})
          </span>
          <ul className="mt-2 space-y-2">
            {ofertas.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-[11px]">
                  {o.artistName}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    esperando respuesta · {String(o.offeredAt).slice(0, 10)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => revocarOferta(o.id)}
                  disabled={busy}
                  className="shrink-0 font-mono text-[9px] tracking-widest text-muted-foreground underline hover:text-primary disabled:opacity-50"
                >
                  RETIRAR
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div className="border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-primary">
            <Clock className="h-3 w-3" /> PENDIENTES ({pending.length})
          </span>
          <ul className="mt-2 space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-xs">
                  {p.artistName}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {p.requestedBy === "collective"
                      ? "· invitado, esperando su respuesta"
                      : "· se postuló, esperando la tuya"}
                  </span>
                </span>
                {/* Only an application is ours to answer. Our own invitation
                    is the DJ's call, so there is nothing to click. */}
                {p.requestedBy === "collective" && (
                  <button
                    type="button"
                    onClick={() => answer(p.id, "cancel")}
                    disabled={busy}
                    className="shrink-0 border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground hover:border-primary disabled:opacity-50"
                  >
                    RETIRAR
                  </button>
                )}
                {p.requestedBy === "artist" && (
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => answer(p.id, "accept")}
                      disabled={busy}
                      className="border border-primary px-2 py-1 font-mono text-[9px] tracking-widest text-primary disabled:opacity-50"
                    >
                      ACEPTAR
                    </button>
                    <button
                      type="button"
                      onClick={() => answer(p.id, "reject")}
                      disabled={busy}
                      className="border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground hover:border-primary disabled:opacity-50"
                    >
                      RECHAZAR
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {departures.length > 0 && (
        <div className="border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            <UserMinus className="h-3 w-3" /> SE FUERON
          </span>
          <ul className="mt-2 space-y-1">
            {departures.map((d) => (
              <li key={`${d.artistSlug}-${d.toDate}`} className="font-mono text-[11px] text-muted-foreground">
                {d.artistName} · {d.kind === "residente" ? "era residente" : "era miembro"} ·{" "}
                {d.toDate.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
        <label className="block min-w-[12rem] flex-1">
          <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">
            INVITAR ARTISTA
          </span>
          <select
            value={artistSlug}
            disabled={busy}
            onChange={(e) => setArtistSlug(e.target.value)}
            className="mt-1 w-full border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="">— elegir —</option>
            {artists
              .filter((a) => !alreadyLinked.has(a.slug))
              .map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          onClick={invite}
          disabled={busy || !artistSlug}
          className="border border-primary px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-primary disabled:opacity-50"
        >
          {busy ? "..." : "INVITAR"}
        </button>
      </div>

      {note && <p className="font-mono text-[11px] text-muted-foreground">{note}</p>}
      {error && (
        <p role="alert" className="font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Invitar no suma a nadie: el DJ tiene que aceptar, y es él quien elige si este
        colectivo, y entra como miembro. La residencia se ofrece aparte y es lo que le deja
        editar el perfil. Quitar cierra el vínculo con fecha,
        no borra el histórico.
      </p>
    </div>
  );
}
