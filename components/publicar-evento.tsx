"use client";

import { useState } from "react";
import { Field, TextAreaField } from "./epk-editable-section";
import { EpkImageField } from "./epk-image-field";

/**
 * PUBLICAR UN EVENTO, desde el panel del colectivo o del venue.
 *
 * Sale publicado al toque: no hay cola de aprobación en eventos, porque
 * una fiesta tiene fecha y un moderador en el medio sería el cuello de
 * botella de la agenda. El formulario lo dice, para que nadie apriete
 * creyendo que todavía lo puede repensar.
 *
 * Los campos son los mismos que carga el admin, menos los editoriales
 * (scope, idioma, destacado, prioridad), que son decisiones de HOTU y no
 * del que publica. Un formulario de la comunidad con un checkbox
 * "DESTACADO" sería un botón para autodestacarse en la home.
 */

export type DestinoPublicacion = {
  slug: string;
  name: string;
  entityKind: "collective" | "venue";
  /** La ciudad, que en collectives vive en sector. Siembra el campo. */
  sector: string;
};

export function PublicarEvento({
  destino,
  onListo,
  onCancelar,
}: {
  destino: DestinoPublicacion;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const esVenue = destino.entityKind === "venue";

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endAt, setEndAt] = useState("");
  // En un venue el lugar es él mismo: el server lo deriva si va vacío, y
  // el campo arranca con el nombre para que se vea qué va a quedar.
  const [venue, setVenue] = useState(esVenue ? destino.name : "");
  const [city, setCity] = useState(destino.sector ?? "");
  const [lineup, setLineup] = useState("");
  const [flyerUrl, setFlyerUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publicar() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizerSlug: destino.slug,
          title,
          date,
          endAt,
          venue,
          city,
          lineup,
          flyerUrl,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo publicar (HTTP ${res.status})`);
        return;
      }
      onListo();
    } catch {
      setError("No se pudo publicar. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Se publica a nombre de{" "}
        <strong className="text-primary">{destino.name}</strong> y sale al sitio en
        cuanto lo mandes: los eventos no esperan aprobación.
      </p>

      <Field label="NOMBRE DE LA FIESTA" value={title} onChange={setTitle} disabled={busy} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="FECHA" type="date" value={date} onChange={setDate} disabled={busy} />
        <Field
          label="CIERRA (OPCIONAL)"
          type="datetime-local"
          value={endAt}
          onChange={setEndAt}
          disabled={busy}
        />
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        La fecha es el día en que empieza. Si termina de madrugada, el cierre va al
        día siguiente.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={esVenue ? "LUGAR" : "LUGAR (EL VENUE)"}
          value={venue}
          onChange={setVenue}
          placeholder={esVenue ? destino.name : "Dónde es"}
          disabled={busy}
        />
        <Field label="CIUDAD" value={city} onChange={setCity} disabled={busy} />
      </div>

      <TextAreaField
        label="LINE UP"
        value={lineup}
        onChange={setLineup}
        rows={3}
        disabled={busy}
      />
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Los nombres separados por coma. Los que ya tengan perfil en HOTU se enlazan
        solos y el toque les aparece en su press kit.
      </p>

      {/* El slug que va acá es el del COLECTIVO, no el de un artista: la
          ruta de subida autoriza los flyers por colectivo justamente para
          que una cuenta que administra sin ser DJ pueda subirlo. */}
      <EpkImageField
        label="FLYER (OPCIONAL)"
        slug={destino.slug}
        kind="flyer"
        target="flyer"
        value={flyerUrl}
        onChange={setFlyerUrl}
        disabled={busy}
        previewClassName="h-28 w-20 object-cover"
      />

      {error && (
        <p role="alert" className="font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={publicar}
          disabled={busy}
          className="surface-chrome sheen px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-40"
        >
          {busy ? "PUBLICANDO..." : "PUBLICAR"}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={busy}
          className="border border-border px-4 py-2.5 font-mono text-[11px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
        >
          CANCELAR
        </button>
      </div>
    </div>
  );
}
