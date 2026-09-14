"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Inbox, UserMinus } from "lucide-react";
import type { CollectiveMember, PendingMembership } from "@/lib/db";
import { CollectiveInfoEditor } from "./collective-info-editor";

/**
 * The collective's side, on its OWNER'S profile.
 *
 * §4.2: the owner administers without switching accounts. That is why this
 * is not the /admin panel — /admin is gated on SUPER_ADMIN, so a plain
 * collective owner could never reach it, and answering an application is
 * not an administrator's job, it is theirs.
 *
 * Applications are theirs to answer. Their own invitations are the DJ's
 * call, so all they can do there is withdraw.
 */
export function CollectiveInbox({
  collectiveSlug,
  collectiveName,
  collectiveBio,
  collectiveSector,
  pending,
  members,
  departures,
}: {
  collectiveSlug: string;
  collectiveName: string;
  collectiveBio: string;
  collectiveSector: string | null;
  pending: PendingMembership[];
  members: CollectiveMember[];
  departures: { artistSlug: string; artistName: string; kind: string; toDate: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(id: number, action: "accept" | "reject" | "cancel") {
    setBusy(true);
    setError(null);
    try {
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
    } catch {
      setError("No se pudo responder. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  const applications = pending.filter((p) => p.requestedBy === "artist");
  const invitations = pending.filter((p) => p.requestedBy === "collective");

  return (
    <div className="border-chrome mt-6 p-6">
      <h3 className="inline-flex items-center gap-2 text-lg font-bold">
        <Inbox className="h-4 w-4 text-primary" />
        <Link href={`/colectivos/${collectiveSlug}`} className="hover:text-primary">
          {collectiveName}
        </Link>
      </h3>
      <p className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">
        {members.length} {members.length === 1 ? "MIEMBRO" : "MIEMBROS"}
      </p>

      {/* Editar la info del colectivo, en el mismo panel donde se
          responden las solicitudes (§5.2: el panel del colectivo). */}
      <CollectiveInfoEditor
        slug={collectiveSlug}
        name={collectiveName}
        bio={collectiveBio}
        sector={collectiveSector}
      />

      {applications.length > 0 && (
        <div className="mt-5">
          <span className="font-mono text-[10px] tracking-[0.2em] text-primary">
            SE POSTULARON ({applications.length})
          </span>
          <ul className="mt-3 space-y-3">
            {applications.map((p) => (
              <li key={p.id} className="border border-border p-3">
                <Link
                  href={`/artistas/${p.artistSlug}`}
                  className="font-bold hover:text-primary"
                >
                  {p.artistName}
                </Link>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Quiere sumarse. Si aceptás, elige después si sos su casa o entra como
                  residente.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => act(p.id, "accept")}
                    disabled={busy}
                    className="surface-chrome sheen px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
                  >
                    ACEPTAR
                  </button>
                  <button
                    type="button"
                    onClick={() => act(p.id, "reject")}
                    disabled={busy}
                    className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary disabled:opacity-50"
                  >
                    RECHAZAR
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="mt-5">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            INVITASTE ({invitations.length})
          </span>
          <ul className="mt-2 space-y-2">
            {invitations.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {p.artistName} · esperando su respuesta
                </span>
                <button
                  type="button"
                  onClick={() => act(p.id, "cancel")}
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

      {applications.length === 0 && invitations.length === 0 && (
        <p className="mt-4 font-mono text-[11px] text-muted-foreground">
          Nada pendiente.
        </p>
      )}

      {departures.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            <UserMinus className="h-3 w-3" /> SE FUERON
          </span>
          <ul className="mt-2 space-y-1">
            {departures.map((d) => (
              <li
                key={`${d.artistSlug}-${d.toDate}`}
                className="font-mono text-[11px] text-muted-foreground"
              >
                {d.artistName} · {d.kind === "casa" ? "era su casa" : "era residente"} ·{" "}
                {d.toDate.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}
    </div>
  );
}
