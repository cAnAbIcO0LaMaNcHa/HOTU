"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { BranchOption, TagOption } from "@/lib/db";
import {
  GenrePicker,
  MAX_TAGS,
  MIN_TAGS,
  type SeleccionGenero,
} from "@/components/genre-picker";

/**
 * "Crear colectivo", on a DJ's own profile (§4.1).
 *
 * Only rendered for a DJ who does not already own one — one per account,
 * and the page decides that, so this component never has to.
 *
 * Si el fundador ya es residente de otro colectivo, el nuevo se abre con él
 * a pertenencia and says so plainly instead of moving their home behind
 * de miembro y le queda una OFERTA de residencia esperando: nada se mueve a
 * three explicit options, in the panel right above.
 */
export function CreateCollectiveButton({
  /** Colectivo o venue: los dos se crean igual, con textos distintos. */
  entityKind = "collective",
  branches = [],
  tags = [],
}: {
  entityKind?: "collective" | "venue";
  /** El vocabulario, solo necesario para un colectivo: un venue no
   *  declara género, porque el género lo tiene la fiesta y no el lugar. */
  branches?: BranchOption[];
  tags?: TagOption[];
} = {}) {
  const esVenue = entityKind === "venue";
  const palabra = esVenue ? "VENUE" : "COLECTIVO";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [genero, setGenero] = useState<SeleccionGenero>({
    primary: "",
    secundarios: [],
    tags: [],
  });

  async function create() {
    if (name.trim() === "") {
      setError("Poné un nombre.");
      return;
    }
    // El género es obligatorio para un colectivo (§2.3) y no aplica a un
    // venue. Se chequea acá y otra vez en el servidor, que es el que manda.
    if (!esVenue) {
      if (!genero.primary) {
        setError("Elegí el género principal del colectivo.");
        return;
      }
      if (genero.tags.length < MIN_TAGS || genero.tags.length > MAX_TAGS) {
        setError(`Elegí entre ${MIN_TAGS} y ${MAX_TAGS} tags.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/collectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          entityKind,
          ...(esVenue
            ? {}
            : {
                primaryBranch: genero.primary,
                secondaryBranches: genero.secundarios,
                tags: genero.tags.map((t) => ({ slug: t.slug, branchCode: t.branchCode })),
              }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo crear (HTTP ${res.status})`);
        return;
      }
      if (esVenue) {
        setNote(
          "Venue creado. Entraste como miembro, que es el único vínculo que un venue tiene: tu residencia sigue donde está."
        );
      } else if (data.ofertaPendiente) {
        /**
         * EL CASO QUE ANTES ERA UN SILENCIO. El fundador ya era residente en
         * otro colectivo, así que este se creó con él de miembro — y hasta la
         * fase 2 eso no se decía en ninguna parte: quedaba fuera del carrusel
         * de RESIDENTES de su propio colectivo sin saber por qué.
         *
         * Ahora hay una oferta esperándolo y el aviso dice dónde está y que
         * nada se movió. El nombre del colectivo anterior va incluido porque
         * "ya tenés una residencia" obliga a ir a buscar cuál.
         */
        setNote(
          `Creado, y sos su dueño. Como sos residente de ${data.ofertaPendiente.actual.name}, ` +
            "acá entraste como miembro y te dejamos una oferta de residencia en tu perfil: " +
            "aceptala cuando quieras y te va a preguntar qué hacer con la anterior. Nada se movió."
        );
      } else if (data.kind === "miembro") {
        setNote(
          "Creado. Entraste como miembro. La residencia se ofrece aparte desde el panel del colectivo."
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

      {/* Un venue no declara género: el género lo tiene la fiesta, no el
          lugar. Por eso el selector no existe en ese camino. */}
      {!esVenue && (
        <div className="mt-6 border-t border-border pt-5">
          <GenrePicker
            branches={branches}
            tags={tags}
            valor={genero}
            onChange={setGenero}
            buscar={buscar}
            onBuscar={setBuscar}
            disabled={busy}
          />
        </div>
      )}

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
