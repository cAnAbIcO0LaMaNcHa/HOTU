"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Disc3, Pencil, X } from "lucide-react";
import type { BranchOption, GenreOfProfile, TagOption } from "@/lib/db";
import { GenrePicker, MAX_TAGS, MIN_TAGS, type SeleccionGenero } from "@/components/genre-picker";

/**
 * GÉNERO, en el press kit de un artista o de un colectivo.
 *
 * La misma sección para los dos: la regla es idéntica y la única
 * diferencia es a qué ruta escribe.
 *
 * ESTA ES LA REGLA EN LA EDICIÓN, no solo en el alta. El alta ya la
 * exigía, pero un perfil creado antes de la taxonomía —los 12 artistas y
 * 6 colectivos de producción— no tiene género y nunca pasó por ese
 * formulario. Sin esto no habría forma de que lo completen.
 *
 * Vacía y sin permiso de editar: no se renderiza. Es la regla del
 * proyecto, el perfil crece con el artista, y un encabezado GÉNERO vacío
 * en el perfil público de alguien no le sirve a nadie. Vacía y CON
 * permiso: se le pide que la complete, porque es el único que puede.
 */
export function GeneroEditable({
  owner,
  slug,
  genero,
  branches,
  tags,
  canEdit,
}: {
  owner: "artist" | "collective";
  slug: string;
  genero: GenreOfProfile;
  branches: BranchOption[];
  tags: TagOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [valor, setValor] = useState<SeleccionGenero>({
    primary: genero.primary?.code ?? "",
    secundarios: genero.secondary.map((b) => b.code),
    tags: genero.tags.map((t) => ({ slug: t.slug, name: t.name, branchCode: t.branchCode })),
  });

  const vacio = genero.primary === null;
  if (vacio && !canEdit) return null;

  async function guardar() {
    setError(null);
    if (!valor.primary) return setError("Elegí un género principal.");
    if (valor.tags.length < MIN_TAGS || valor.tags.length > MAX_TAGS) {
      return setError(`Elegí entre ${MIN_TAGS} y ${MAX_TAGS} tags.`);
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/genres/${owner}/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryBranch: valor.primary,
          secondaryBranches: valor.secundarios,
          tags: valor.tags.map((t) => ({ slug: t.slug, branchCode: t.branchCode })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo guardar (HTTP ${res.status})`);
        return;
      }
      setEditando(false);
      router.refresh();
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (editando) {
    return (
      <div className="mt-14">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">GÉNERO</h2>
          <button
            type="button"
            onClick={() => {
              setEditando(false);
              setError(null);
            }}
            className="text-muted-foreground hover:text-primary"
            aria-label="Cancelar edición"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-chrome mt-4 p-4">
          <GenrePicker
            branches={branches}
            tags={tags}
            valor={valor}
            onChange={setValor}
            buscar={buscar}
            onBuscar={setBuscar}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="mt-4 font-mono text-[11px] text-primary">
              {error}
            </p>
          )}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={busy}
              className="surface-chrome sheen px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-50"
            >
              {busy ? "GUARDANDO..." : "GUARDAR"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditando(false);
                setError(null);
              }}
              disabled={busy}
              className="border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/70 hover:border-primary disabled:opacity-50"
            >
              CANCELAR
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-14">
      <h2 className="text-2xl font-bold">GÉNERO</h2>

      {vacio ? (
        <p className="mt-4 border border-dashed border-border px-4 py-6 font-mono text-xs leading-relaxed text-muted-foreground">
          Todavía no declaraste tu género. Es lo que usa la gente para encontrarte, y
          va a ser el filtro principal de todo el sitio. Elegí una rama y de{" "}
          {MIN_TAGS} a {MAX_TAGS} tags.
        </p>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 border border-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary">
              <Disc3 className="h-3 w-3" /> {genero.primary!.name}
            </span>
            {genero.secondary.map((b) => (
              <span
                key={b.code}
                className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground"
              >
                {b.name}
              </span>
            ))}
          </div>
          {genero.tags.length > 0 && (
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {genero.tags.map((t) => t.name).join(" · ")}
            </p>
          )}
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="mt-4 inline-flex items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/70 hover:border-primary hover:text-primary"
        >
          <Pencil className="h-3 w-3" />
          {vacio ? "ELEGIR MI GÉNERO" : "EDITAR EL GÉNERO"}
        </button>
      )}
    </div>
  );
}
