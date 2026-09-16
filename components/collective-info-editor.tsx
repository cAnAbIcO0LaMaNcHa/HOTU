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
 * to slip into a bio edit. El distrito ya no existe como concepto
 * editable: se retiró entero en la tanda 4 §3 y la columna quedó
 * congelada hasta que se borre.
 */
export function CollectiveInfoEditor({
  slug,
  name,
  bio,
  sector,
  entityKind = "collective",
  address,
  capacity,
}: {
  slug: string;
  name: string;
  bio: string;
  sector: string | null;
  /** Un venue edita dos campos más: dirección y aforo (§5). */
  entityKind?: "collective" | "venue";
  address?: string | null;
  capacity?: number | null;
}) {
  const esVenue = entityKind === "venue";
  const [draftName, setDraftName] = useState(name);
  const [draftBio, setDraftBio] = useState(bio ?? "");
  const [draftSector, setDraftSector] = useState(sector ?? "");
  const [draftAddress, setDraftAddress] = useState(address ?? "");
  const [draftCapacity, setDraftCapacity] = useState(
    capacity == null ? "" : String(capacity)
  );

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
        // Solo se mandan si es un venue: el endpoint rechaza estos dos
        // contra un colectivo, y mandarlos vacíos haría fallar el guardado
        // de la bio por un campo que este perfil ni siquiera muestra.
        ...(esVenue ? { address: draftAddress, capacity: draftCapacity } : {}),
      })}
      form={(saving) => (
        <>
          <Field
            label="NOMBRE"
            value={draftName}
            onChange={setDraftName}
            placeholder={esVenue ? "Bodega 38" : "Reisen"}
            disabled={saving}
          />
          <Field
            label={esVenue ? "SECTOR (DÓNDE QUEDA)" : "SECTOR (DE DÓNDE SON)"}
            value={draftSector}
            onChange={setDraftSector}
            placeholder="Chapinero, Bogotá"
            disabled={saving}
          />
          {esVenue && (
            <>
              <Field
                label="DIRECCIÓN"
                value={draftAddress}
                onChange={setDraftAddress}
                placeholder="Calle 80 # 14 - 11"
                disabled={saving}
              />
              <Field
                label="AFORO"
                type="number"
                value={draftCapacity}
                onChange={setDraftCapacity}
                placeholder="400"
                disabled={saving}
              />
            </>
          )}
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
        {esVenue && (
          <div>
            {address || "Sin dirección"}
            {capacity != null ? ` · aforo ${capacity}` : " · sin aforo"}
          </div>
        )}
        {bio ? (
          <p className="mt-1 max-w-2xl">{bio}</p>
        ) : (
          <p className="mt-1 italic">Todavía no escribiste una bio.</p>
        )}
      </div>
    </EpkEditableSection>
  );
}
