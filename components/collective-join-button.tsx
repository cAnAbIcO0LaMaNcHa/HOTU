"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus } from "lucide-react";

/**
 * ÚNETE A NOSOTROS — the entry point of the whole membership flow (§4.3).
 *
 * Shown only to a signed-in DJ who is not already linked to this
 * collective. Everyone else sees either nothing or a reason, because a
 * button that fails when clicked is worse than one that is not there.
 *
 * Applying does not join: it opens a conversation the collective has to
 * answer. The copy says so, so nobody expects to be a member on click.
 */
export function CollectiveJoinButton({
  collectiveSlug,
  collectiveName,
  artistSlug,
  state,
  entityKind = "collective",
}: {
  collectiveSlug: string;
  collectiveName: string;
  /** The viewer's own artist profile, if they have one. */
  artistSlug: string | null;
  /** Why the button is not actionable, when it is not. */
  state: "can-apply" | "signed-out" | "no-artist" | "pending" | "member";
  /**
   * Un venue admite residentes y nada más. Cambia el texto —no se ofrece
   * elegir casa— y el enlace de vuelta después de iniciar sesión.
   */
  entityKind?: "collective" | "venue";
}) {
  const esVenue = entityKind === "venue";
  const palabra = esVenue ? "venue" : "colectivo";
  const volverA = esVenue ? `/venues/${collectiveSlug}` : `/colectivos/${collectiveSlug}`;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function apply() {
    if (!artistSlug) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectiveSlug, artistSlug, requestedBy: "artist" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo enviar (HTTP ${res.status})`);
        return;
      }
      setSent(true);
      router.refresh();
    } catch {
      setError("No se pudo enviar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "member") return null;

  if (state === "pending" || sent) {
    return (
      <div className="border-chrome mt-12 p-6 text-center">
        <p className="font-mono text-xs tracking-widest text-primary">
          POSTULACIÓN ENVIADA
        </p>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {collectiveName} tiene que responder. Vas a verla en tu perfil mientras espera.
        </p>
        {/* Al panel ARTISTA, que es donde viven las conversaciones de
            membresía desde que /perfil se partió en cuatro. Mandarlo a
            /perfil pelado lo dejaba en MI PERFIL, mirando sus pedidos —
            una transición no deja una página peor que antes. */}
        <Link
          href="/perfil?panel=artista"
          className="mt-3 inline-block font-mono text-[10px] tracking-[0.2em] text-muted-foreground underline hover:text-primary"
        >
          VER MIS POSTULACIONES
        </Link>
      </div>
    );
  }

  if (state === "signed-out") {
    return (
      <div className="border-chrome mt-12 p-6 text-center">
        <p className="font-mono text-[11px] text-muted-foreground">
          Entrá con tu cuenta de DJ para postularte a {collectiveName}.
        </p>
        <Link
          href={`/auth/signin?callbackUrl=${encodeURIComponent(volverA)}`}
          className="surface-chrome sheen mt-3 inline-flex px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em]"
        >
          INICIAR SESIÓN
        </Link>
      </div>
    );
  }

  if (state === "no-artist") {
    return (
      <div className="border-chrome mt-12 p-6 text-center">
        <p className="font-mono text-[11px] text-muted-foreground">
          Solo una cuenta con perfil de DJ puede postularse a un {palabra}.
        </p>
      </div>
    );
  }

  return (
    <div className="border-chrome mt-12 p-6 text-center">
      <button
        type="button"
        onClick={apply}
        disabled={busy}
        className="surface-chrome sheen inline-flex items-center gap-2 px-6 py-3 font-mono text-xs font-bold tracking-[0.2em] disabled:opacity-50"
      >
        <UserPlus className="h-4 w-4" />
        {busy ? "ENVIANDO..." : "ÚNETE A NOSOTROS"}
      </button>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {esVenue ? (
          <>
            Enviás una postulación: {collectiveName} la acepta o la rechaza. Si te
            aceptan, entrás como residente. Tu casa sigue siendo tu colectivo — un
            venue no es la casa de nadie.
          </>
        ) : (
          <>
            Enviás una postulación: {collectiveName} la acepta o la rechaza. Si te
            aceptan, vos elegís si es tu casa o si entrás como residente.
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}
    </div>
  );
}
