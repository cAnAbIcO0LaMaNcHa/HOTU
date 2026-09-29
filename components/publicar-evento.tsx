"use client";

import { useState } from "react";
import { armarInstante, diaEnPalabras } from "@/lib/date-utils";
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
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // En un venue el lugar es él mismo: el server lo deriva si va vacío, y
  // el campo arranca con el nombre para que se vea qué va a quedar.
  const [venue, setVenue] = useState(esVenue ? destino.name : "");
  const [city, setCity] = useState(destino.sector ?? "");
  const [lineup, setLineup] = useState("");
  const [flyerUrl, setFlyerUrl] = useState("");
  const [doorPrice, setDoorPrice] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * El aviso sale de armarInstante, la MISMA función que usa el write path. Si acá
   * se calculara aparte, la pantalla y la base podrían decir días distintos — y el
   * que se entera es el organizador, mirando la agenda después de publicar.
   *
   * date-utils es puro y no importa nada de la base, así que un client component
   * puede usarlo sin arrastrar el DATABASE_URL al navegador.
   */
  const inicio = date && startTime ? armarInstante(date, startTime) : null;
  const cierre = date && endTime ? armarInstante(date, endTime) : null;
  const avisoMadrugada = (() => {
    const partes: string[] = [];
    if (inicio?.esMadrugada) {
      partes.push(`empieza la madrugada del ${diaEnPalabras(inicio.dia)}`);
    }
    if (cierre?.esMadrugada) {
      partes.push(`cierra la madrugada del ${diaEnPalabras(cierre.dia)}`);
    }
    return partes.length > 0 ? `Se va a guardar así: ${partes.join(", y ")}.` : null;
  })();

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
          startTime,
          endTime,
          venue,
          city,
          lineup,
          flyerUrl,
          doorPriceCop: doorPrice,
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

      <Field label="FECHA" type="date" value={date} onChange={setDate} disabled={busy} />

      {/*
        DOS HORAS SUELTAS, no un datetime-local.

        El datetime-local obligaba al organizador a elegir el DÍA del cierre, que
        es la parte que se equivoca: una fiesta del sábado cierra el domingo, y
        nadie lo piensa así al llenar un formulario. Peor, ese campo mandaba un
        instante sin zona que el server interpretaba en UTC — cinco horas de error
        sin síntoma.

        Ahora van las dos horas y el día lo deduce la regla de la madrugada, que es
        la misma en la pantalla y en el server porque sale de la misma función.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="EMPIEZA (OPCIONAL)"
          type="time"
          value={startTime}
          onChange={setStartTime}
          disabled={busy}
        />
        <Field
          label="CIERRA (OPCIONAL)"
          type="time"
          value={endTime}
          onChange={setEndTime}
          disabled={busy}
        />
      </div>

      {/* SE DICE EN CLARO ANTES DE GUARDAR, con el día nombrado. Sin esto el
          organizador no tiene forma de saber que su 1:00 se guardó en otra fecha,
          y lo iba a descubrir mirando la agenda. */}
      {avisoMadrugada && (
        <p className="font-mono text-[10px] leading-relaxed text-primary">{avisoMadrugada}</p>
      )}
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        La fecha es la noche de la fiesta. Una hora entre 00:00 y 06:00 se entiende como
        madrugada, así que cae en el día siguiente — el flyer sigue diciendo la fecha de
        arriba. Si no ponés horas, la página no muestra ninguna.
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

      {/*
        PRECIO EN TAQUILLA, y el texto de abajo dice las dos cosas que el
        organizador necesita saber: que es solo un anuncio, y que dejarlo vacío
        no es lo mismo que poner 0.

        type="text" y no "number": acá la plata se escribe con puntos —35.000— y
        un input numérico los rechaza o los come según el navegador. El lib
        acepta los puntos y valida; pedirle a alguien que escriba el precio
        distinto de como lo lee es pedirle que se equivoque.
      */}
      <Field
        label="PRECIO EN TAQUILLA"
        value={doorPrice}
        onChange={setDoorPrice}
        placeholder="35.000"
        disabled={busy}
      />
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Solo informativo: se muestra en la página del evento como "Taquilla: $35.000". HOTU
        todavía no vende boletas, así que acá no se cobra nada. Si lo dejás vacío no se
        muestra nada — y eso no es lo mismo que poner 0, que anuncia entrada libre.
      </p>

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
