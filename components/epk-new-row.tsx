"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Field } from "./epk-editable-section";

/**
 * PUBLICAR un set o un track, con la opción de invitar colaboradores
 * (§6.1).
 *
 * ESTO NO EXISTÍA. Los endpoints POST de sets y tracks estaban desde la
 * tanda 2, pero no había un solo formulario que los llamara: un DJ no
 * podía agregar una grabación desde el sitio, solo con curl. La sección
 * DJ SETS incluso le decía "subí una grabación" sin darle con qué.
 *
 * ============================================================
 * INVITAR A ALGUIEN CONGELA LA PIEZA, PARA SIEMPRE
 * ============================================================
 *
 * Sin colaboradores, la pieza vive en la casa ACTUAL de su autor y se
 * muda con él cada vez que cambie de casa. Con aunque sea un
 * colaborador, queda FIJA donde se publicó y no se mueve nunca más.
 *
 * Eso no se puede deshacer sacando al colaborador después, así que el
 * formulario lo dice ANTES, en el momento de elegir, y no en un tooltip.
 */

type Candidato = { slug: string; name: string; kind: "artist" | "collective" };

export function EpkNewRow({
  artistSlug,
  collection,
  /** Artistas y colectivos publicados, para elegir a quién invitar. */
  candidatos,
  /** Si el autor NO tiene casa hoy. Cambia lo que dice el aviso. */
  sinCasa,
}: {
  artistSlug: string;
  collection: "sets" | "tracks";
  candidatos: Candidato[];
  sinCasa: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [buscar, setBuscar] = useState("");
  const [invitados, setInvitados] = useState<Candidato[]>([]);

  const esSet = collection === "sets";

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="h-3 w-3" /> {esSet ? "SUBIR SET" : "SUBIR TRACK"}
      </button>
    );
  }

  // No se ofrece a quien ya está invitado, ni el autor a sí mismo: el
  // write path los rechaza igual, pero ofrecer algo que va a devolver un
  // error es hacerle perder el tiempo a la persona.
  const elegidos = new Set(invitados.map((c) => `${c.kind}:${c.slug}`));
  const sugerencias =
    buscar.trim() === ""
      ? []
      : candidatos
          .filter(
            (c) =>
              !(c.kind === "artist" && c.slug === artistSlug) &&
              !elegidos.has(`${c.kind}:${c.slug}`) &&
              c.name.toLowerCase().includes(buscar.trim().toLowerCase())
          )
          .slice(0, 6);

  async function publicar() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        title,
        url: url.trim() === "" ? null : url,
        collaborators: invitados.map((c) =>
          c.kind === "artist" ? { artistSlug: c.slug } : { collectiveSlug: c.slug }
        ),
      };
      if (esSet) {
        body.recordedAt = date;
        body.duration = duration.trim() === "" ? null : duration;
      } else {
        body.releasedAt = date;
      }

      const res = await fetch(
        `/api/artists/${encodeURIComponent(artistSlug)}/${collection}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo publicar (HTTP ${res.status})`);
        return;
      }
      setAbierto(false);
      setTitle("");
      setDate("");
      setUrl("");
      setDuration("");
      setInvitados([]);
      router.refresh();
    } catch {
      setError("No se pudo publicar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border border-border p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em] text-primary">
          {esSet ? "NUEVO SET" : "NUEVO TRACK"}
        </span>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          aria-label="Cerrar"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="TÍTULO" value={title} onChange={setTitle} disabled={busy} />
        <Field
          label={esSet ? "GRABADO EL" : "LANZADO EL"}
          type="date"
          value={date}
          onChange={setDate}
          disabled={busy}
        />
        <Field
          label="LINK"
          value={url}
          onChange={setUrl}
          placeholder="https://soundcloud.com/..."
          disabled={busy}
        />
        {esSet && (
          <Field
            label="DURACIÓN"
            value={duration}
            onChange={setDuration}
            placeholder="60:00"
            disabled={busy}
          />
        )}
      </div>

      {/* --- colaboradores (§6.1) --- */}
      <div className="mt-6 border-t border-border pt-4">
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          COLABORADORES (OPCIONAL)
        </span>

        {invitados.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {invitados.map((c) => (
              <span
                key={`${c.kind}:${c.slug}`}
                className="inline-flex items-center gap-1.5 border border-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary"
              >
                {c.name}
                {c.kind === "collective" ? " · COLECTIVO" : ""}
                <button
                  type="button"
                  onClick={() =>
                    setInvitados((v) => v.filter((x) => !(x.kind === c.kind && x.slug === c.slug)))
                  }
                  aria-label={`Sacar a ${c.name}`}
                  disabled={busy}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          type="search"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar un artista o colectivo..."
          aria-label="Buscar colaboradores"
          disabled={busy}
          className="mt-3 w-full border border-border bg-background px-3 py-2 font-mono text-xs hover:border-primary focus:border-primary focus:outline-none"
        />

        {sugerencias.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {sugerencias.map((c) => (
              <button
                key={`${c.kind}:${c.slug}`}
                type="button"
                disabled={busy}
                onClick={() => {
                  setInvitados((v) => [...v, c]);
                  setBuscar("");
                }}
                className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary"
              >
                {c.name}
                {c.kind === "collective" ? " · COLECTIVO" : ""}
              </button>
            ))}
          </div>
        )}

        {/* La consecuencia, ANTES de publicar y no después. Que la pieza
            quede fija no se deshace sacando al colaborador más tarde. */}
        {invitados.length > 0 && (
          <p className="mt-3 border border-dashed border-primary/50 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {sinCasa ? (
              <>
                <strong className="text-primary">
                  Esta pieza NO va a aparecer en ningún colectivo, ni ahora ni cuando entres a
                  uno.
                </strong>{" "}
                Todavía no tenés una casa, y las piezas con colaboradores quedan fijas donde se
                publican: no se mueven después. Si querés que aparezca en tu casa, entrá a un
                colectivo primero y publicala después.
              </>
            ) : (
              <>
                Al invitar a alguien, esta pieza queda <strong className="text-primary">fija</strong>{" "}
                donde se publica: va a tu casa de hoy y a la de cada quien acepte, y no se muda
                aunque después cambies de casa. Sin colaboradores, en cambio, se mudaría con vos.
              </>
            )}
          </p>
        )}

        {invitados.length > 0 && (
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Cada persona tiene que aceptar la invitación. Hasta que acepte, la pieza no aparece en
            su casa.
          </p>
        )}
      </div>

      {error && <p className="mt-4 font-mono text-[10px] text-red-400">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={publicar}
          disabled={busy || title.trim() === "" || date.trim() === ""}
          className="surface-chrome sheen px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
        >
          {busy ? "PUBLICANDO..." : "PUBLICAR"}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          disabled={busy}
          className="border border-border px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary"
        >
          CANCELAR
        </button>
      </div>
    </div>
  );
}
