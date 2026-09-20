"use client";

import { useId, useState } from "react";
import { Field, TextAreaField } from "./epk-editable-section";
import type { DestinoPublicacion } from "./publicar-evento";

/**
 * PUBLICAR UNA NOTICIA, desde el panel del colectivo o del venue.
 *
 * A diferencia del evento, esta NO sale sola: entra en una cola y la
 * publica la aprobación. El formulario lo dice antes de apretar, porque
 * la diferencia entre "ya está en el sitio" y "la va a leer alguien
 * primero" es exactamente lo que alguien necesita saber al mandar.
 *
 * Dos botones y no uno: GUARDAR y MANDAR. Escribir una noticia lleva más
 * que tipear un título, y sin borrador la única salida del que no
 * terminó es mandar algo a medias o perderlo.
 */
export function PublicarNoticia({
  destino,
  tagsSugeridos,
  onListo,
  onCancelar,
}: {
  destino: DestinoPublicacion;
  /** Las etiquetas que ya se usaron. Sugerencia, no vocabulario cerrado. */
  tagsSugeridos: string[];
  onListo: () => void;
  onCancelar: () => void;
}) {
  const listaId = useId();

  const [title, setTitle] = useState("");
  const [tag, setTag] = useState("");
  const [date, setDate] = useState("");
  const [excerpt, setExcerpt] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(enviar: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorCollectiveSlug: destino.slug,
          title,
          tag,
          date,
          excerpt,
          enviar,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo guardar (HTTP ${res.status})`);
        return;
      }
      onListo();
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Se firma como <strong className="text-primary">{destino.name}</strong>. A
        diferencia de un evento, esta pasa por revisión: la publicamos cuando alguien
        del equipo la lea. Si hay algo para corregir, te lo vas a encontrar acá mismo
        con el motivo.
      </p>

      <Field label="TÍTULO" value={title} onChange={setTitle} disabled={busy} />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* datalist, no <select>: las etiquetas de news son texto libre y
            cerrar el vocabulario es una decisión que no corresponde tomar
            de paso. Sugerir las que ya existen es lo único que evita que
            la misma cosa termine escrita de cinco formas. */}
        <label className="block">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            ETIQUETA
          </span>
          <input
            list={listaId}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            disabled={busy}
            placeholder="RELEASE, CLUB, FIESTA..."
            className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
          />
          <datalist id={listaId}>
            {tagsSugeridos.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        <Field
          label="FECHA (SI LA DEJÁS VACÍA, HOY)"
          type="date"
          value={date}
          onChange={setDate}
          disabled={busy}
        />
      </div>

      <TextAreaField label="LA NOTICIA" value={excerpt} onChange={setExcerpt} rows={7} disabled={busy} />

      {error && (
        <p role="alert" className="font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={() => guardar(true)}
          disabled={busy}
          className="surface-chrome sheen px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-40"
        >
          {busy ? "MANDANDO..." : "MANDAR A REVISIÓN"}
        </button>
        <button
          type="button"
          onClick={() => guardar(false)}
          disabled={busy}
          className="border border-border px-4 py-2.5 font-mono text-[11px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary disabled:opacity-50"
        >
          GUARDAR BORRADOR
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={busy}
          className="px-4 py-2.5 font-mono text-[11px] tracking-[0.2em] text-muted-foreground hover:text-primary disabled:opacity-50"
        >
          CANCELAR
        </button>
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        El borrador se queda acá y no lo ve nadie más. Una vez aprobada y publicada ya
        no se edita: si hay que corregir algo, se publica otra.
      </p>
    </div>
  );
}
