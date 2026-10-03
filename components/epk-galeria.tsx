"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { EpkSection, Field } from "./epk-editable-section";
import { EpkImageField } from "./epk-image-field";
import type { ArtistPhoto } from "@/lib/db";
import { MAX_FOTOS } from "@/lib/galeria-limites";

/**
 * GALERÍA — fotos en alta para que el organizador arme flyers.
 *
 * El tope es 12 por artista, y la UI lo DICE en vez de solo impedirlo: un botón que
 * desaparece sin explicación se lee como un bug. La guarda de verdad está en el write
 * path, adentro del INSERT, porque un tope en la pantalla no es un tope — la API sigue
 * ahí.
 *
 * SIN PIE DE FOTO, CON CRÉDITO DEL FOTÓGRAFO. Son dos cosas distintas y solo una hace
 * falta: una foto que existe para que alguien arme un flyer no necesita que le expliquen
 * qué se ve, pero el que la sacó sí necesita figurar. El crédito es OPCIONAL porque muchas
 * fotos de fiesta no lo tienen, y exigirlo haría que alguien escriba "desconocido" para
 * poder guardar.
 */
export function EpkGaleria({
  photos,
  canEdit,
  artistSlug,
}: {
  photos: ArtistPhoto[];
  canEdit: boolean;
  artistSlug: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [credit, setCredit] = useState("");

  const lleno = photos.length >= MAX_FOTOS;

  const agregar = async () => {
    setError(null);
    if (!url) {
      setError("Elegí una imagen o pegá un link.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/artists/${artistSlug}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, credit: credit.trim() === "" ? null : credit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        /** El 409 del tope trae su propio mensaje con el número, así que se muestra tal
         *  cual en vez de reemplazarlo por uno genérico. */
        setError(data.error ?? "No se pudo agregar la foto.");
        return;
      }
      setUrl("");
      setCredit("");
      setAbierto(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const borrar = async (id: number) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/artists/${artistSlug}/photos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo borrar la foto.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EpkSection
      title="GALERÍA"
      anchor="galeria"
      isEmpty={photos.length === 0}
      canEdit={canEdit}
      hint="Subí fotos en alta. Son las que un organizador va a usar para armar el flyer de su fiesta, así que cuanto mejores, más fácil es que te programen."
      action={
        canEdit ? (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            disabled={busy || (lleno && !abierto)}
            className="font-mono text-[10px] tracking-[0.2em] text-primary underline disabled:opacity-50"
          >
            {/* El tope se DICE. Un botón deshabilitado y mudo manda a adivinar. */}
            {lleno ? `TOPE DE ${MAX_FOTOS} FOTOS` : abierto ? "CANCELAR" : "+ FOTO"}
          </button>
        ) : null
      }
    >
      {abierto && canEdit && (
        <div className="mt-4 space-y-3 border border-border p-4">
          <EpkImageField
            label="FOTO"
            slug={artistSlug}
            kind="galeria"
            target="galeria"
            value={url}
            onChange={setUrl}
            disabled={busy}
            previewClassName="h-24 w-24"
          />
          <Field
            label="CRÉDITO DEL FOTÓGRAFO (OPCIONAL)"
            value={credit}
            onChange={setCredit}
            placeholder="@quien.la.saco"
            disabled={busy}
          />
          <button
            type="button"
            onClick={agregar}
            disabled={busy}
            className="font-mono text-[10px] tracking-[0.2em] text-primary underline disabled:opacity-50"
          >
            {busy ? "GUARDANDO…" : "GUARDAR"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 font-mono text-[10px] tracking-widest text-destructive">{error}</p>
      )}

      {photos.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {photos.map((p) => (
            <figure key={p.id} className="group relative">
              {/* Link directo al archivo: el punto de la sección es que el organizador se
                  lleve la foto en alta, así que tiene que poder abrirla sola. */}
              <a href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.credit ? `Foto de ${p.credit}` : ""}
                  className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </a>
              {p.credit && (
                <figcaption className="mt-1 truncate font-mono text-[9px] tracking-widest text-muted-foreground">
                  {p.credit}
                </figcaption>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => borrar(p.id)}
                  disabled={busy}
                  aria-label="Borrar la foto"
                  className="absolute right-1 top-1 bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </EpkSection>
  );
}
