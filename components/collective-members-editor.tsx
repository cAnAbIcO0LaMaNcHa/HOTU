"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { CollectiveMember } from "@/lib/db";

/**
 * Membership management for one collective, in the admin.
 *
 * This replaces the old "slugs separados por coma" text field, which wrote
 * the collectives.artist_slugs jsonb. That column is no longer written;
 * memberships are rows in artist_collectives, and rows need a kind — the
 * residente/toca_con distinction is what sales attribution rests on, and a
 * comma-separated list cannot express it.
 *
 * Everything goes through /api/collectives/[slug]/members, per the repo
 * rule that no component writes directly.
 */
export function CollectiveMembersEditor({
  collectiveSlug,
  members,
  artists,
  statusMembership,
}: {
  collectiveSlug: string;
  members: CollectiveMember[];
  /** The catalogue to pick from: slug + name. */
  artists: { slug: string; name: string }[];
  statusMembership: string;
}) {
  const router = useRouter();
  const [artistSlug, setArtistSlug] = useState("");
  const [kind, setKind] = useState<"residente" | "toca_con">("toca_con");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(statusMembership);

  const base = `/api/collectives/${encodeURIComponent(collectiveSlug)}/members`;
  const alreadyIn = new Set(members.map((m) => m.artistSlug));

  async function add() {
    if (!artistSlug) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistSlug, kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo agregar (HTTP ${res.status})`);
        return;
      }
      setStatus(data.statusMembership ?? status);
      setArtistSlug("");
      router.refresh();
    } catch {
      setError("No se pudo agregar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo quitar (HTTP ${res.status})`);
        return;
      }
      setStatus(data.statusMembership ?? status);
      router.refresh();
    } catch {
      setError("No se pudo quitar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sm:col-span-2 border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          MIEMBROS ({members.length})
        </span>
        <span
          className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${
            status === "activo"
              ? "border-primary text-primary"
              : "border-muted-foreground text-muted-foreground"
          }`}
        >
          {status === "activo" ? "PUEDE CREAR EVENTOS" : "INCOMPLETO"}
        </span>
      </div>

      {members.length === 0 ? (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          Sin miembros. Se necesitan 3 DJs, 2 de ellos residentes, para poder publicar eventos.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {members.map((m) => (
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
                  {m.kind === "residente" ? "RESIDENTE" : "TOCA CON"}
                </span>
                <span className="ml-2 text-[10px] text-muted-foreground">desde {m.fromDate.slice(0, 10)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(m.artistSlug)}
                disabled={busy}
                className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-50"
                aria-label={`Quitar a ${m.artistName}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="block min-w-[12rem] flex-1">
          <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">ARTISTA</span>
          <select
            value={artistSlug}
            disabled={busy}
            onChange={(e) => setArtistSlug(e.target.value)}
            className="mt-1 w-full border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="">— elegir —</option>
            {artists
              .filter((a) => !alreadyIn.has(a.slug))
              .map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">VÍNCULO</span>
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => setKind(e.target.value as "residente" | "toca_con")}
            className="mt-1 border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="toca_con">Toca con</option>
            <option value="residente">Residente</option>
          </select>
        </label>
        <button
          type="button"
          onClick={add}
          disabled={busy || !artistSlug}
          className="border border-primary px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-primary disabled:opacity-50"
        >
          {busy ? "..." : "AGREGAR"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Residente es uno solo por DJ y es el vínculo que cuenta plata. Quitar a alguien cierra
        el vínculo con fecha, no borra el histórico.
      </p>
    </div>
  );
}
