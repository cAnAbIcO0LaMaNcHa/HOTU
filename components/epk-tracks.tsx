"use client";

import { useState } from "react";
import { Disc3 } from "lucide-react";
import { EpkNewRow } from "./epk-new-row";
import { EpkSection, Field } from "./epk-editable-section";
import { EpkRowEditor } from "./epk-row-editor";
import { formatShortDate } from "@/lib/date-utils";
import type { CandidatoColab, Track } from "@/lib/db";

const VISIBLE = 5;

/**
 * TRACKS — the artist's own productions, as squares in a row.
 *
 * Cover art, label and release date, which is what the sketch asked for
 * and the schema could not carry until tanda 2 added the columns. A track
 * with no cover falls back to a plain chrome placeholder rather than a
 * broken image, because the profile grows with the artist. El tinte por
 * distrito se fue con el sistema de color (tanda 4 §3): el placeholder
 * queda con la paleta única de :root.
 *
 * Separate from DJ SETS on purpose: two sections, never tabs.
 */
export function EpkTracks({
  tracks,
  canEdit,
  artistSlug,
  candidatos,
  sinCasa,
}: {
  tracks: Track[];
  canEdit: boolean;
  artistSlug: string;
  candidatos: CandidatoColab[];
  sinCasa: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tracks : tracks.slice(0, VISIBLE);

  return (
    <EpkSection
      title="TRACKS"
      anchor="tracks"
      isEmpty={tracks.length === 0}
      canEdit={canEdit}
      action={
        canEdit ? (
          <EpkNewRow
            artistSlug={artistSlug}
            collection="tracks"
            candidatos={candidatos}
            sinCasa={sinCasa}
          />
        ) : null
      }
      hint="Todavía no hay tracks propios acá. Agregá tus producciones para que el perfil muestre qué hacés además de tocar."
    >
      <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
        {shown.map((t) => (
          <div key={t.slug} className="w-44 shrink-0">
            <a href={t.url} className="group block">
              <span
                className="sheen border-chrome flex aspect-square w-full items-center justify-center overflow-hidden transition-colors group-hover:border-primary"
              >
                {t.coverUrl ? (
                  <img
                    src={t.coverUrl}
                    alt={`Portada de ${t.title}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Disc3 className="h-10 w-10 text-chrome" />
                )}
              </span>
              <span className="mt-2 block truncate text-sm font-bold">{t.title}</span>
              {t.label && (
                <span className="block truncate font-mono text-[10px] tracking-widest text-primary">
                  {t.label}
                </span>
              )}
              <span className="block font-mono text-[10px] tracking-widest text-muted-foreground">
                {formatShortDate(t.releasedAt)}
              </span>
            </a>

            {canEdit && (
              <EpkRowEditor
                artistSlug={artistSlug}
                collection="tracks"
                rowSlug={t.slug}
                title={t.title}
                initial={{
                  title: t.title,
                  date: t.releasedAt.slice(0, 10),
                  url: t.url === "#" ? "" : t.url,
                  coverUrl: t.coverUrl ?? "",
                  label: t.label ?? "",
                  sortOrder: t.sortOrder?.toString() ?? "",
                }}
                extra={(disabled, values, set) => (
                  <Field
                    label="SELLO"
                    value={values.label ?? ""}
                    onChange={(v) => set("label", v)}
                    placeholder="Nombre del sello"
                    disabled={disabled}
                  />
                )}
              />
            )}
          </div>
        ))}

        {tracks.length > VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 self-center px-2 font-mono text-[11px] tracking-[0.2em] text-muted-foreground hover:text-primary"
          >
            {expanded ? "← MENOS" : "MORE →"}
          </button>
        )}
      </div>
    </EpkSection>
  );
}
