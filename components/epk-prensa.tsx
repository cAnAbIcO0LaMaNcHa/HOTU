"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Trash2 } from "lucide-react";
import { EpkSection, Field } from "./epk-editable-section";
import type { ArtistPressItem } from "@/lib/db";

/**
 * PRENSA — links a notas, con el medio y la fecha.
 *
 * EL MEDIO ES TEXTO LIBRE, no una lista cerrada, y es una decisión: la escena publica en
 * blogs, en revistas chicas y en Instagram, así que una lista de medios "válidos" dejaría
 * afuera justo lo que más hay. El costo es que el mismo medio se puede escribir de dos
 * maneras; el beneficio es que entra todo.
 *
 * LA FECHA ES OPCIONAL. Una nota vieja de un blog puede no tenerla, y la regla del repo es
 * no inventar datos: nulo es "no se sabe", no "hoy". Si falta, la fila muestra el medio
 * solo, y el orden la manda al final en vez de arriba —NULLS LAST— porque una nota sin
 * fecha no es la más reciente.
 */
export function EpkPrensa({
  items,
  canEdit,
  artistSlug,
}: {
  items: ArtistPressItem[];
  canEdit: boolean;
  artistSlug: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outlet, setOutlet] = useState("");
  const [url, setUrl] = useState("");
  const [fecha, setFecha] = useState("");

  const agregar = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/artists/${artistSlug}/press`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet,
          url,
          /** Vacío se manda como null y no como "": el write path lo acepta como
           *  "sin fecha", que es distinto de una fecha inválida. */
          publishedAt: fecha.trim() === "" ? null : fecha,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo agregar la nota.");
        return;
      }
      setOutlet("");
      setUrl("");
      setFecha("");
      setAbierto(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const borrar = async (id: number) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/artists/${artistSlug}/press/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo borrar la nota.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EpkSection
      title="PRENSA"
      anchor="prensa"
      isEmpty={items.length === 0}
      canEdit={canEdit}
      hint="Si te entrevistaron o reseñaron un track, pegá el link. Una nota de un medio dice algo que tu propia bio no puede decir."
      action={
        canEdit ? (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            disabled={busy}
            className="font-mono text-[10px] tracking-[0.2em] text-primary underline disabled:opacity-50"
          >
            {abierto ? "CANCELAR" : "+ NOTA"}
          </button>
        ) : null
      }
    >
      {abierto && canEdit && (
        <div className="mt-4 space-y-3 border border-border p-4">
          <Field
            label="MEDIO"
            value={outlet}
            onChange={setOutlet}
            placeholder="Resident Advisor"
            disabled={busy}
          />
          <Field
            label="LINK DE LA NOTA"
            value={url}
            onChange={setUrl}
            placeholder="https://..."
            disabled={busy}
          />
          <Field
            label="FECHA (OPCIONAL)"
            type="date"
            value={fecha}
            onChange={setFecha}
            disabled={busy}
          />
          <button
            type="button"
            onClick={agregar}
            disabled={busy}
            className="font-mono text-[10px] tracking-[0.2em] text-primary underline disabled:opacity-50"
          >
            {busy ? "GUARDANDO…" : "GUARDAR"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 font-mono text-[10px] tracking-widest text-destructive">{error}</p>
      )}

      {items.length > 0 && (
        <ul className="mt-6 space-y-2">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="sheen border-chrome flex min-w-0 flex-1 items-center gap-3 p-3 transition-colors hover:border-primary"
              >
                <ExternalLink className="h-3 w-3 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-bold">{p.outlet}</span>
                {/* Solo si existe. Un guión en su lugar invitaría a creer que la nota no
                    tiene fecha porque es de hoy. */}
                {p.publishedAt && (
                  <span className="shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground">
                    {p.publishedAt}
                  </span>
                )}
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => borrar(p.id)}
                  disabled={busy}
                  aria-label={`Borrar la nota de ${p.outlet}`}
                  className="shrink-0 p-1 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </EpkSection>
  );
}
