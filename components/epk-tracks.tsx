"use client";

import { useState } from "react";
import { Disc3 } from "lucide-react";
import { EpkSection } from "./epk-editable-section";
import { formatShortDate } from "@/lib/date-utils";
import type { Track } from "@/lib/db";

const VISIBLE = 5;

/**
 * TRACKS — the artist's own productions, as squares in a row.
 *
 * The spec also asks for a cover image and a label per track. Neither
 * column exists on `tracks` yet (AGENTS.md lists them as pending for tanda
 * 2, along with the manual ordering field), so each square falls back to a
 * district-tinted placeholder and shows only the release date for now.
 */
export function EpkTracks({
  tracks,
  canEdit,
}: {
  tracks: Track[];
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tracks : tracks.slice(0, VISIBLE);

  return (
    <EpkSection
      title="TRACKS"
      isEmpty={tracks.length === 0}
      canEdit={canEdit}
      hint="Todavía no hay tracks propios acá. Agregá tus producciones para que el perfil muestre qué hacés además de tocar."
    >
      <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
        {shown.map((t) => (
          <a
            key={t.slug}
            href={t.url}
            className="group w-40 shrink-0"
          >
            <span
              data-district={t.district}
              className="sheen border-chrome flex aspect-square w-full items-center justify-center overflow-hidden transition-colors group-hover:border-primary"
            >
              <Disc3 className="h-10 w-10 text-chrome" />
            </span>
            <span className="mt-2 block truncate text-sm font-bold">{t.title}</span>
            <span className="block font-mono text-[10px] tracking-widest text-muted-foreground">
              {formatShortDate(t.releasedAt)}
            </span>
          </a>
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
