"use client";

import { useState } from "react";
import { AutoTranslate } from "./auto-translate";
import { EpkEditableSection, Field, TextAreaField } from "./epk-editable-section";
import type { Artist } from "@/lib/db";

/**
 * "Sobre mí": origen, rango de BPM, biografía.
 *
 * `origin` is where the artist is from and `city` (edited in the header) is
 * where they live now — the project doc is explicit that these are not the
 * same field and must not be merged.
 *
 * EL DISTRITO SE FUE (tanda 4 §3). Lo que mostraba era
 * "{distrito} · {artist.genre}", y de eso solo el distrito era decorado:
 * artist.genre es un campo propio del artista.
 *
 * Por eso genre queda de SUPLENTE de la sección GÉNERO, que va acá
 * abajo: si el perfil ya declaró género de taxonomía, esa sección lo
 * dice mejor y esta fila no se muestra; si no —los 12 artistas de
 * producción, que son anteriores a la taxonomía—, se muestra la vieja.
 * Sin eso, a un visitante esos perfiles le quedaban sin ningún género a
 * la vista, porque GÉNERO vacía no se renderiza para quien no puede
 * editar. Una transición no deja una página peor que antes.
 */
export function EpkAbout({
  artist,
  canEdit,
  tieneGeneroDeclarado,
}: {
  artist: Artist;
  canEdit: boolean;
  /** ¿Ya declaró género de taxonomía? Si sí, el viejo no hace falta. */
  tieneGeneroDeclarado: boolean;
}) {
  const [origin, setOrigin] = useState(artist.origin ?? "");
  const [bpmMin, setBpmMin] = useState(artist.bpmMin?.toString() ?? "");
  const [bpmMax, setBpmMax] = useState(artist.bpmMax?.toString() ?? "");
  const [bio, setBio] = useState(artist.bio);

  const generoViejo = !tieneGeneroDeclarado && artist.genre ? artist.genre : null;
  const hasBpm = artist.bpmMin != null || artist.bpmMax != null;
  const bpmLabel =
    artist.bpmMin != null && artist.bpmMax != null
      ? `${artist.bpmMin}–${artist.bpmMax} BPM`
      : `${artist.bpmMin ?? artist.bpmMax} BPM`;

  // Nothing written yet and nobody who could write it: render nothing at all
  // rather than an empty heading.
  const isEmpty = !artist.bio && !artist.origin && !hasBpm && !generoViejo;
  if (isEmpty && !canEdit) return null;

  return (
    <div className="mt-14">
      <h2 className="text-2xl font-bold">SOBRE MÍ</h2>
      <EpkEditableSection
        slug={artist.slug}
        canEdit={canEdit}
        title="sobre mí"
        className="mt-4"
        buildPatch={() => ({
          origin: origin.trim() === "" ? null : origin,
          bpmMin: bpmMin.trim() === "" ? null : Number(bpmMin),
          bpmMax: bpmMax.trim() === "" ? null : Number(bpmMax),
          bio,
        })}
        form={(saving) => (
          <>
            <Field
              label="ORIGEN (DE DÓNDE SOS)"
              value={origin}
              onChange={setOrigin}
              placeholder="Bogotá, Colombia"
              disabled={saving}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="BPM MÍNIMO"
                type="number"
                value={bpmMin}
                onChange={setBpmMin}
                placeholder="138"
                disabled={saving}
              />
              <Field
                label="BPM MÁXIMO"
                type="number"
                value={bpmMax}
                onChange={setBpmMax}
                placeholder="150"
                disabled={saving}
              />
            </div>
            <TextAreaField label="BIOGRAFÍA" value={bio} onChange={setBio} disabled={saving} />
          </>
        )}
      >
        <div>
          {/* generoViejo, no artist.genre: un artista CON taxonomía y con
              genre cargado pero sin origen ni BPM abría un <dl> sin una
              sola fila adentro. Los 12 de producción están a un paso de
              ese estado — todos tienen genre y ninguno tiene origen ni
              BPM—, así que lo disparaba el primero que declarara género. */}
          {(artist.origin || hasBpm || generoViejo) && (
            <dl className="flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs tracking-widest text-muted-foreground">
              {artist.origin && (
                <div>
                  <dt className="text-[10px] tracking-[0.3em] text-primary">ORIGEN</dt>
                  <dd className="mt-1 text-foreground/80">{artist.origin}</dd>
                </div>
              )}
              {hasBpm && (
                <div>
                  <dt className="text-[10px] tracking-[0.3em] text-primary">BPM</dt>
                  <dd className="mt-1 text-foreground/80">{bpmLabel}</dd>
                </div>
              )}
              {/* "SIN CLASIFICAR" y no "GÉNERO" a secas: al dueño de un
                  perfil sin taxonomía esto le queda justo encima de la
                  sección GÉNERO diciéndole que todavía no declaró ninguno,
                  y dos rótulos iguales que se contradicen se leen como un
                  bug. Con el paréntesis las dos frases dicen lo mismo: hay
                  un género viejo de texto libre y falta clasificarlo. */}
              {generoViejo && (
                <div>
                  <dt className="text-[10px] tracking-[0.3em] text-primary">
                    GÉNERO (SIN CLASIFICAR)
                  </dt>
                  <dd className="mt-1 text-foreground/80">{generoViejo}</dd>
                </div>
              )}
            </dl>
          )}

          {artist.bio && (
            <p className="mt-6 max-w-3xl font-mono text-sm leading-relaxed text-muted-foreground">
              <AutoTranslate text={artist.bio} />
            </p>
          )}
        </div>
      </EpkEditableSection>
    </div>
  );
}
