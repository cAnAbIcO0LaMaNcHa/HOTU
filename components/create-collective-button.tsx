"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/**
 * "Crear colectivo", on a DJ's own profile (§4.1).
 *
 * Only rendered for a DJ who does not already own one — one per account,
 * and the page decides that, so this component never has to.
 *
 * If the founder already has a casa somewhere, the new collective opens as
 * a residencia and says so plainly instead of moving their home behind
 * their back. Changing it is then the ordinary casa conversation, with its
 * three explicit options, in the panel right above.
 */
export function CreateCollectiveButton({
  /** Colectivo o venue: los dos se crean igual, con textos distintos. */
  entityKind = "collective",
}: {
  entityKind?: "collective" | "venue";
} = {}) {
  const esVenue = entityKind === "venue";
  const palabra = esVenue ? "VENUE" : "COLECTIVO";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function create() {
    if (name.trim() === "") {
      setError("Poné un nombre.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/collectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, entityKind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo crear (HTTP ${res.status})`);
        return;
      }
      if (esVenue) {
        setNote(
          "Venue creado. Entraste como residente, que es el único vínculo que un venue tiene: tu casa sigue siendo tu colectivo."
        );
      } else if (data.kind === "residente") {
        setNote(
          "Creado. Como ya tenés casa en otro colectivo, entraste a este como residente. Si querés que sea tu casa, cambialo desde COLECTIVOS, acá arriba."
        );
      }
      setOpen(false);
      setName("");
      router.refresh();
    } catch {
      setError("No se pudo crear. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (note) {
    return (
      <p className="border-chrome mt-10 p-6 font-mono text-[11px] leading-relaxed">{note}</p>
    );
  }

  if (!open) {
    return (
      <div className="mt-10">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary"
        >
          <Plus className="h-3 w-3" /> CREAR {palabra}
        </button>
      </div>
    );
  }

  return (
    <div className="border-chrome mt-10 p-6">
      <h2 className="text-xl font-bold">CREAR {palabra}</h2>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Uno por cuenta. Quedás como dueño y como primer miembro. La ciudad y el resto
        de la info salen de tu perfil y se editan después.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={esVenue ? "Nombre del venue" : "Nombre del colectivo"}
        disabled={busy}
        className="mt-4 w-full max-w-sm border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
      />
      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="surface-chrome sheen px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-50"
        >
          {busy ? "CREANDO..." : "CREAR"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/70 hover:border-primary disabled:opacity-50"
        >
          CANCELAR
        </button>
      </div>
    </div>
  );
}
