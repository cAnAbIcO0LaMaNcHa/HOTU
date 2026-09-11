"use client";

import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { EpkImageField } from "./epk-image-field";
import { Field } from "./epk-editable-section";

/**
 * Edit or delete one row of a list section (a set, a track).
 *
 * Same shape as the section editor in epk-editable-section: read view by
 * default, form on click, everything through the API. The cover is the
 * reason this exists at all — an upload endpoint nobody can reach from the
 * page is only usable with curl.
 */
export function EpkRowEditor({
  artistSlug,
  /** "sets" or "tracks" — the path segment under /api/artists/[slug]. */
  collection,
  rowSlug,
  title,
  /** Extra fields beyond the shared title/date/link/cover. */
  extra,
  initial,
}: {
  artistSlug: string;
  collection: "sets" | "tracks";
  rowSlug: string;
  title: string;
  extra?: (disabled: boolean, values: Record<string, string>, set: (k: string, v: string) => void) => React.ReactNode;
  initial: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(initial);

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const base = `/api/artists/${encodeURIComponent(artistSlug)}/${collection}/${encodeURIComponent(rowSlug)}`;

  /** Empty string means "clear the column", so it is sent as null rather
   *  than as "", which would store a blank instead of nothing. */
  const orNull = (v: string) => (v.trim() === "" ? null : v);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        title: values.title,
        url: orNull(values.url),
        coverUrl: orNull(values.coverUrl),
        sortOrder: orNull(values.sortOrder),
      };
      if (collection === "sets") {
        body.recordedAt = values.date;
        body.duration = orNull(values.duration);
      } else {
        body.releasedAt = values.date;
        body.label = orNull(values.label);
      }

      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo guardar (HTTP ${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo borrar (HTTP ${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("No se pudo borrar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-muted-foreground hover:text-primary"
      >
        <Pencil className="h-3 w-3" /> EDITAR
      </button>
    );
  }

  return (
    <div className="border-chrome mt-2 p-3 text-left">
      <div className="flex items-center justify-between">
        <span className="truncate font-mono text-[10px] tracking-[0.2em] text-primary">
          {title}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-primary"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <Field label="TÍTULO" value={values.title ?? ""} onChange={(v) => set("title", v)} disabled={busy} />
        <Field
          label={collection === "sets" ? "FECHA DE GRABACIÓN" : "FECHA DE LANZAMIENTO"}
          type="date"
          value={values.date ?? ""}
          onChange={(v) => set("date", v)}
          disabled={busy}
        />
        <Field label="LINK" value={values.url ?? ""} onChange={(v) => set("url", v)} placeholder="https://..." disabled={busy} />
        {extra?.(busy, values, set)}
        <Field
          label="ORDEN (VACÍO = POR FECHA)"
          type="number"
          value={values.sortOrder ?? ""}
          onChange={(v) => set("sortOrder", v)}
          disabled={busy}
        />
        <EpkImageField
          label="PORTADA"
          slug={artistSlug}
          kind="track-cover"
          target="trackCover"
          value={values.coverUrl ?? ""}
          onChange={(v) => set("coverUrl", v)}
          disabled={busy}
          previewClassName="h-16 w-16"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 font-mono text-[10px] text-primary">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="surface-chrome sheen px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
        >
          {busy ? "..." : "GUARDAR"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/60 hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" /> BORRAR
        </button>
      </div>
    </div>
  );
}
