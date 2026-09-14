"use client";

import { AutoTranslate } from "@/components/auto-translate";

/**
 * What a listing says when it has nothing to show.
 *
 * Two different situations that used to share one message: the section is
 * genuinely empty, or the user's own search and filters excluded
 * everything. Telling somebody "todavía no hay artistas" right after they
 * typed a name reads as a broken page rather than as no match.
 */
export function EmptyResult({ active, empty }: { active: boolean; empty: string }) {
  return (
    <p className="col-span-full font-mono text-sm text-muted-foreground">
      <AutoTranslate
        text={active ? "Nada coincide con lo que buscaste. Probá con menos filtros." : empty}
      />
    </p>
  );
}
