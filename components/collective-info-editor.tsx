"use client";

import { useState } from "react";
import { EpkEditableSection, Field, TextAreaField } from "./epk-editable-section";

/**
 * The collective's own information, edited in place by its owner.
 *
 * Same shell the press kit uses, pointed at the collective route instead of
 * the artist one — an owner editing their collective and a DJ editing their
 * press kit should not feel like two different products.
 *
 * The slug is not offered. It is the primary key and the address everybody
 * has already shared; renaming it is a deliberate operation, not something
 * to slip into a bio edit. District is left out too, since the district
 * system is being removed (HOTFIX punto 1).
 */
export function CollectiveInfoEditor({
  slug,
  name,
  bio,
  sector,
}: {
  slug: string;
  name: string;
  bio: string;
  sector: string | null;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftBio, setDraftBio] = useState(bio ?? "");
  const [draftSector, setDraftSector] = useState(sector ?? "");

  return (
    <EpkEditableSection
      slug={slug}
      canEdit
      title="la info"
      className="mt-5"
      endpoint={(s) => `/api/collectives/${encodeURIComponent(s)}`}
      buildPatch={() => ({
        name: draftName,
        bio: draftBio,
        sector: draftSector,
      })}
      form={(saving) => (
        <>
          <Field
            label="NOMBRE"
            value={draftName}
            onChange={setDraftName}
            placeholder="Reisen"
            disabled={saving}
          />
          <Field
            label="SECTOR (DE DÓNDE SON)"
            value={draftSector}
            onChange={setDraftSector}
            placeholder="Chapinero, Bogotá"
            disabled={saving}
          />
          <TextAreaField
            label="BIO"
            value={draftBio}
            onChange={setDraftBio}
            disabled={saving}
          />
        </>
      )}
    >
      <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
        {sector && <div>{sector}</div>}
        {bio ? (
          <p className="mt-1 max-w-2xl">{bio}</p>
        ) : (
          <p className="mt-1 italic">Todavía no escribiste una bio.</p>
        )}
      </div>
    </EpkEditableSection>
  );
}
