"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Pencil, X } from "lucide-react";

/**
 * The edit shell every EPK section shares: read view by default, form on
 * click, save through the API.
 *
 * Instagram-style means there is no /admin for this — the owner edits where
 * they read. When `canEdit` is false the component renders the children and
 * nothing else, so a visitor sees a plain profile with no dead controls.
 *
 * Client component on purpose, but it only ever talks to an API route —
 * it never imports lib/db.ts or any write module.
 *
 * The endpoint is a prop because collectives edit the same way artists do.
 * It defaults to the artist route, so every existing caller is unchanged.
 */
export function EpkEditableSection({
  slug,
  canEdit,
  title,
  children,
  form,
  buildPatch,
  endpoint,
  className = "",
}: {
  slug: string;
  canEdit: boolean;
  /** Screen-reader label for the edit button, e.g. "la cabecera". */
  title: string;
  children: ReactNode;
  /** Rendered while editing. Receives the pending-save flag. */
  form: (saving: boolean) => ReactNode;
  /** Reads the current form values into the JSON body for the PATCH. */
  buildPatch: () => Record<string, unknown>;
  /** Where the PATCH goes. Defaults to the artist route. */
  endpoint?: (slug: string) => string;
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const url = endpoint
        ? endpoint(slug)
        : `/api/artists/${encodeURIComponent(slug)}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPatch()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo guardar (HTTP ${res.status})`);
        return;
      }
      setEditing(false);
      // The server component re-reads from the database, so what ends up on
      // screen is what was actually stored, not the optimistic guess.
      router.refresh();
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) return <>{children}</>;

  return (
    <div className={`relative ${className}`}>
      {editing ? (
        <div className="border-chrome p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-[0.3em] text-primary">
              EDITANDO
            </span>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="text-muted-foreground hover:text-primary"
              aria-label="Cancelar edición"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 space-y-3">{form(saving)}</div>

          {error && (
            <p role="alert" className="mt-3 font-mono text-[11px] text-primary">
              {error}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="surface-chrome sheen px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-50"
            >
              {saving ? "GUARDANDO..." : "GUARDAR"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
              className="border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/70 hover:border-primary hover:text-primary disabled:opacity-50"
            >
              CANCELAR
            </button>
          </div>
        </div>
      ) : (
        <>
          {children}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 inline-flex items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/70 hover:border-primary hover:text-primary"
          >
            <Pencil className="h-3 w-3" /> EDITAR {title.toUpperCase()}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A whole EPK section, applying the profile's growth rule: a section with
 * nothing in it is not rendered at all for a visitor. The owner sees a
 * prompt instead, because "there is nothing here yet" is useful to the
 * person who can fix it and noise to everyone else. A DJ with three gigs
 * must not be shown eight empty headings.
 */
export function EpkSection({
  title,
  isEmpty,
  canEdit,
  hint,
  children,
  action,
  anchor,
}: {
  title: string;
  isEmpty: boolean;
  canEdit: boolean;
  /** What the owner is told to do when the section has no content yet. */
  hint: string;
  children: ReactNode;
  action?: ReactNode;
  /**
   * El id para linkear la sección desde afuera. Lo usa el "+" del panel
   * ARTISTA, que en vez de duplicar el formulario de subir un set manda
   * a donde ya está. Sin ancla, ese link deja a alguien arriba de todo
   * en un perfil largo, buscando a mano la sección que pidió.
   */
  anchor?: string;
}) {
  if (isEmpty && !canEdit) return null;

  return (
    <div id={anchor} className="mt-14 scroll-mt-24">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-bold">{title}</h2>
        {action}
      </div>
      {isEmpty ? (
        <p className="mt-4 border border-dashed border-border px-4 py-6 font-mono text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

/** Labelled text input used by the EPK forms. */
export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
      />
    </label>
  );
}

/** Multi-line variant, for the biography. */
export function TextAreaField({
  label,
  value,
  onChange,
  rows = 6,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm leading-relaxed text-foreground outline-none focus:border-primary disabled:opacity-50"
      />
    </label>
  );
}
