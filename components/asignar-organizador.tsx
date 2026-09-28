"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type OpcionOrganizador = {
  slug: string;
  name: string;
  entityKind: "collective" | "venue";
};

/**
 * Le pone organizador a UN evento, desde moderación.
 *
 * El selector arranca vacío y no en la primera opción. Con una lista larga y un
 * default silencioso, el camino más corto es apretar guardar sin leer — y lo que
 * se guarda es la convocatoria de una fiesta atribuida al colectivo equivocado.
 * Un "elegí" que obliga a elegir cuesta un clic y evita eso.
 */
export function AsignarOrganizador({
  eventId,
  actual,
  opciones,
}: {
  eventId: number;
  /** El organizador de hoy, o null si no tiene. */
  actual: string | null;
  opciones: OpcionOrganizador[];
}) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);

  const guardar = async (valor: string | null) => {
    setBusy(true);
    setError(null);
    setNota(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/organizer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectiveSlug: valor }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo guardar (HTTP ${res.status})`);
        return;
      }
      setNota(
        valor === null
          ? "Le saqué el organizador. El evento sigue publicado, sin dueño."
          : `Asignado a ${valor}. Su lineup ya le cuenta de convocatoria.`
      );
      setSlug("");
      router.refresh();
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  };

  const elegido = opciones.find((o) => o.slug === slug);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        ORGANIZADOR
      </span>

      {actual ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px]">
            {actual}
          </span>
          {/* Sacárselo tiene que ser posible: una asignación equivocada le da la
              convocatoria de una fiesta a quien no la hizo. */}
          <button
            type="button"
            onClick={() => guardar(null)}
            disabled={busy}
            className="font-mono text-[9px] tracking-widest text-muted-foreground underline hover:text-primary disabled:opacity-50"
          >
            SACÁRSELO
          </button>
        </div>
      ) : (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          Sin organizador. Nadie puede corregirlo y su lineup no le suma
          convocatoria a ningún colectivo.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={busy}
          className="min-w-0 flex-1 border border-border bg-transparent px-2 py-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary disabled:opacity-50"
        >
          <option value="">— elegí a nombre de quién —</option>
          {opciones.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.name}
              {o.entityKind === "venue" ? " (venue)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => elegido && guardar(elegido.slug)}
          disabled={busy || !elegido || elegido.slug === actual}
          className="shrink-0 border border-primary px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-primary disabled:opacity-40"
        >
          {actual ? "CAMBIAR" : "ASIGNAR"}
        </button>
      </div>

      {/* Se dice ANTES de guardar lo que va a pasar, no después. Asignar mueve
          números de convocatoria de un press kit a otro, y eso no se ve en esta
          pantalla. */}
      {elegido && elegido.slug !== actual && (
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Su lineup va a contarle de convocatoria a <strong>{elegido.name}</strong>, y va a
          poder editar el evento
          {actual ? `. ${actual} lo pierde.` : "."}
        </p>
      )}

      {nota && <p className="mt-2 font-mono text-[10px] text-primary">{nota}</p>}
      {error && (
        <p role="alert" className="mt-2 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}
    </div>
  );
}
