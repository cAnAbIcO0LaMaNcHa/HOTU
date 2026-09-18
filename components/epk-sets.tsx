"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { EpkSection, Field } from "./epk-editable-section";
import { EpkNewRow } from "./epk-new-row";
import { EpkRowEditor } from "./epk-row-editor";
import type { CandidatoColab, DjSet } from "@/lib/db";

const VISIBLE = 4;

/**
 * A stable pseudo-waveform derived from the set's slug.
 *
 * The bars have to look like an audio shape without any audio being
 * decoded, and they must not change between renders — a Math.random()
 * waveform would differ on the server and the client and blow up
 * hydration. Hashing the slug gives the same bars every time for a given
 * set, and different bars for different sets.
 */
function waveform(seed: string, bars = 40): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: bars }, (_, i) => {
    h = (h * 1103515245 + 12345 + i) >>> 0;
    return 25 + ((h >>> 8) % 75);
  });
}

/**
 * DJ SETS — recorded sets, as horizontal bars with a play control.
 * Separate from TRACKS on purpose: the project doc is explicit that these
 * are two sections, never tabs.
 */
export function EpkSets({
  sets,
  canEdit,
  artistSlug,
  candidatos,
  sinCasa,
}: {
  sets: DjSet[];
  canEdit: boolean;
  artistSlug: string;
  /** A quién se puede invitar a colaborar (§6.1). */
  candidatos: CandidatoColab[];
  /** Si el autor no tiene casa hoy: cambia lo que dice el aviso. */
  sinCasa: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? sets : sets.slice(0, VISIBLE);

  return (
    <EpkSection
      title="DJ SETS"
      isEmpty={sets.length === 0}
      canEdit={canEdit}
      action={
        canEdit ? (
          <EpkNewRow
            artistSlug={artistSlug}
            collection="sets"
            candidatos={candidatos}
            sinCasa={sinCasa}
          />
        ) : null
      }
      hint="Todavía no hay sets acá. Subí una grabación para que los organizadores escuchen cómo sonás antes de contratarte."
    >
      <div className="mt-6 space-y-3">
        {shown.map((s) => (
          <div key={s.slug}>
            <a
              href={s.url}
              className="sheen border-chrome flex items-center gap-4 p-4 transition-colors hover:border-primary"
            >
              {/* The cover replaces the play circle when there is one — a
                  set with artwork should show it, and one without still
                  needs an obvious play affordance. */}
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground">
                {s.coverUrl ? (
                  <img
                    src={s.coverUrl}
                    alt={`Portada de ${s.title}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Play className="h-4 w-4 translate-x-0.5" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{s.title}</span>
                <span className="mt-1 block font-mono text-[10px] tracking-widest text-muted-foreground">
                  {s.duration}
                  {s.recordedAt ? ` · ${s.recordedAt.slice(0, 10)}` : ""}
                </span>
              </span>

              <span
                aria-hidden
                className="hidden h-10 shrink-0 items-end gap-[2px] md:flex"
              >
                {waveform(s.slug).map((height, i) => (
                  <span
                    key={i}
                    style={{ height: `${height}%` }}
                    className="w-[3px] bg-foreground/25"
                  />
                ))}
              </span>
            </a>

            {canEdit && (
              <EpkRowEditor
                artistSlug={artistSlug}
                collection="sets"
                rowSlug={s.slug}
                title={s.title}
                initial={{
                  title: s.title,
                  date: s.recordedAt.slice(0, 10),
                  url: s.url === "#" ? "" : s.url,
                  coverUrl: s.coverUrl ?? "",
                  duration: s.duration ?? "",
                  sortOrder: s.sortOrder?.toString() ?? "",
                }}
                extra={(disabled, values, set) => (
                  <Field
                    label="DURACIÓN"
                    value={values.duration ?? ""}
                    onChange={(v) => set("duration", v)}
                    placeholder="1H 45M"
                    disabled={disabled}
                  />
                )}
              />
            )}
          </div>
        ))}
      </div>

      {sets.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 font-mono text-[11px] tracking-[0.2em] text-muted-foreground hover:text-primary"
        >
          {expanded ? "MENOS" : "MORE..."}
        </button>
      )}
    </EpkSection>
  );
}
