"use client";

import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import type { Collective, CollectiveMember } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { useFilteredList, useListingFilters } from "@/components/listing-filters";
import { EmptyResult } from "@/components/listing-empty";

/**
 * Las tarjetas de /venues.
 *
 * Muy parecidas a las de /colectivos, y no compartidas con ellas a
 * propósito: un venue muestra dirección y aforo, que un colectivo no
 * tiene, y la etiqueta de sus miembros es "RESIDENTES" y no "ARTISTAS DE
 * LA MARCA" porque en un venue nadie tiene su casa. Unificarlas sería
 * meter condicionales en el render para ahorrar un archivo.
 */
export function VenuesList({
  venues,
  members,
}: {
  venues: Collective[];
  members: Record<string, CollectiveMember[]>;
}) {
  const { active } = useListingFilters();
  const sorted = useFilteredList(venues, {
    search: (v) => [
      v.name,
      v.sector,
      v.bio,
      v.address,
      ...(members[v.slug] ?? []).map((m) => m.artistName),
    ],
    secondaryOf: (v) => v.sector,
  });

  return (
    <div className="mt-16">
      <div className="grid gap-6 md:grid-cols-2">
        {sorted.map((v) => {
          const roster = members[v.slug] ?? [];
          return (
            <article
              key={v.slug}
              className="relative border border-border bg-card p-6 transition-colors hover:border-primary"
            >
              <h3 className="text-xl font-bold">
                {/* Overlay estirado, no un <a> envolviendo la tarjeta: los
                    residentes de adentro son enlaces y anidarlos es HTML
                    inválido. */}
                <Link
                  href={`/venues/${v.slug}`}
                  className="hover:text-primary after:absolute after:inset-0 after:z-0 after:content-['']"
                >
                  {v.name}
                </Link>
              </h3>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                {v.address ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" /> {v.address}
                  </span>
                ) : (
                  v.sector && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      <AutoTranslate text={v.sector} />
                    </span>
                  )
                )}
                {v.capacity != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> {v.capacity}
                  </span>
                )}
              </div>

              {v.bio && (
                <p className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground">
                  <AutoTranslate text={v.bio} />
                </p>
              )}

              {roster.length > 0 && (
                <div className="mt-4">
                  <div className="font-mono text-[9px] tracking-widest text-primary">
                    <AutoTranslate text="RESIDENTES" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {roster.map((m) => (
                      <Link
                        key={m.artistSlug}
                        href={`/artistas/${m.artistSlug}`}
                        className="relative z-10 border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary"
                      >
                        <AutoTranslate text={m.artistName} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <EmptyResult active={active} empty="Todavía no hay venues." />
      )}
    </div>
  );
}
