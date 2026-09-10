"use client";

import { useState } from "react";
import { AutoTranslate } from "./auto-translate";
import { EpkEditableSection, Field, TextAreaField } from "./epk-editable-section";
import { getDistrict } from "@/lib/districts";
import type { Artist } from "@/lib/db";

/**
 * "Sobre mí": origin, BPM range, genre/district, biography.
 *
 * `origin` is where the artist is from and `city` (edited in the header) is
 * where they live now — the project doc is explicit that these are not the
 * same field and must not be merged.
 */
export function EpkAbout({ artist, canEdit }: { artist: Artist; canEdit: boolean }) {
  const [origin, setOrigin] = useState(artist.origin ?? "");
  const [bpmMin, setBpmMin] = useState(artist.bpmMin?.toString() ?? "");
  const [bpmMax, setBpmMax] = useState(artist.bpmMax?.toString() ?? "");
  const [bio, setBio] = useState(artist.bio);

  const district = getDistrict(artist.district);
  const hasBpm = artist.bpmMin != null || artist.bpmMax != null;
  const bpmLabel =
    artist.bpmMin != null && artist.bpmMax != null
      ? `${artist.bpmMin}–${artist.bpmMax} BPM`
      : `${artist.bpmMin ?? artist.bpmMax} BPM`;

  // Nothing written yet and nobody who could write it: render nothing at all
  // rather than an empty heading.
  const isEmpty = !artist.bio && !artist.origin && !hasBpm;
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
          {(artist.origin || hasBpm || artist.genre) && (
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
              <div>
                <dt className="text-[10px] tracking-[0.3em] text-primary">DISTRITO</dt>
                <dd className="mt-1 text-foreground/80">
                  {district.title} · {artist.genre}
                </dd>
              </div>
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
