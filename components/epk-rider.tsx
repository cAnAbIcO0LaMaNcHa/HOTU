"use client";

import { useState } from "react";
import { AutoTranslate } from "./auto-translate";
import { EpkEditableSection, Field, TextAreaField } from "./epk-editable-section";
import type { Artist } from "@/lib/db";
import {
  RIDER_EJEMPLOS,
  RIDER_EQUIPOS,
  RIDER_LABELS,
  RIDER_LLEVA_CANTIDAD,
  RIDER_MAX_CANTIDAD,
  piezaEnPalabras,
  piezaVacia,
  riderVacio,
  type RiderEquipo,
} from "@/lib/rider";

/**
 * RIDER TÉCNICO: lo que el DJ necesita en la cabina.
 *
 * Híbrido por decisión de producto: campos fijos para CDJs, mixer y monitores —que es lo
 * que hay en casi todas las cabinas y por lo tanto lo que conviene que sea comparable— más
 * una línea libre de "otros" para lo que no entra en el molde.
 *
 * LA CANTIDAD NO ESTÁ EN LOS TRES CAMPOS, y no es un olvido: RIDER_LLEVA_CANTIDAD dice
 * dónde significa algo. "2 CDJ-3000" es un requisito; "1 DJM-900NXS2" no agrega nada,
 * porque el mixer es uno. Un campo que siempre dice lo mismo es un campo que el DJ llena
 * sin leer.
 *
 * SECCIÓN VACÍA NO SE MUESTRA, que es la regla de UI del EPK: el perfil crece con el
 * artista y un DJ nuevo no puede ver ocho secciones en blanco. Al dueño sí se le muestra,
 * porque para él el vacío es una invitación a completar y no un hueco.
 *
 * Los 17 artistas de dev y los 12 de main tienen la columna en {}, así que hoy esta
 * sección existe solo para los dueños. Eso es lo esperado, no un problema.
 */
export function EpkRider({ artist, canEdit }: { artist: Artist; canEdit: boolean }) {
  const rider = artist.rider;

  /**
   * El estado del formulario es PLANO —una entrada de texto por campo— y no el objeto
   * anidado. Un <input> trabaja con strings: guardar números en el estado obliga a
   * convertir en cada tecleo, y entonces borrar el contenido de "cantidad" se vuelve NaN
   * mientras se escribe. Se arma el objeto al guardar, en buildPatch, y una sola vez.
   */
  const [campos, setCampos] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const e of RIDER_EQUIPOS) {
      inicial[`${e}.marca`] = rider[e]?.marca ?? "";
      inicial[`${e}.modelo`] = rider[e]?.modelo ?? "";
      inicial[`${e}.cantidad`] = rider[e]?.cantidad?.toString() ?? "";
    }
    return inicial;
  });
  const [otros, setOtros] = useState(rider.otros ?? "");

  const set = (k: string) => (v: string) => setCampos((c) => ({ ...c, [k]: v }));

  const vacio = riderVacio(rider);
  if (vacio && !canEdit) return null;

  return (
    <div className="mt-14">
      <h2 className="text-2xl font-bold">RIDER TÉCNICO</h2>
      <EpkEditableSection
        slug={artist.slug}
        canEdit={canEdit}
        title="el rider técnico"
        className="mt-4"
        buildPatch={() => {
          /**
           * Se manda el rider ENTERO y siempre, incluso vacío. Vaciar todos los campos y
           * guardar TIENE que borrar el rider, y un patch que omitiera las claves vacías
           * dejaría el valor viejo en la base: el UPDATE no distingue "no lo mandó" de
           * "lo mandó vacío" si la clave no viaja.
           *
           * Los strings van crudos: normalizarRider recorta, descarta y acota del lado del
           * servidor. Validar acá además sería una segunda definición de lo mismo, y dos
           * definiciones es cómo se desincronizan.
           */
          const out: Record<string, unknown> = {};
          for (const e of RIDER_EQUIPOS) {
            const pieza: Record<string, unknown> = {
              marca: campos[`${e}.marca`],
              modelo: campos[`${e}.modelo`],
            };
            if (RIDER_LLEVA_CANTIDAD[e]) pieza.cantidad = campos[`${e}.cantidad`];
            out[e] = pieza;
          }
          out.otros = otros;
          return { rider: out };
        }}
        form={(saving) => (
          <>
            {RIDER_EQUIPOS.map((e) => (
              <FilaEquipo
                key={e}
                equipo={e}
                campos={campos}
                set={set}
                disabled={saving}
              />
            ))}
            <TextAreaField
              label="OTROS (LO QUE NO ENTRA ARRIBA)"
              value={otros}
              onChange={setOtros}
              rows={3}
              disabled={saving}
            />
          </>
        )}
      >
        <div>
          {vacio ? null : (
            <dl className="flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs tracking-widest text-muted-foreground">
              {RIDER_EQUIPOS.filter((e) => !piezaVacia(rider[e])).map((e) => (
                <div key={e}>
                  <dt className="text-[10px] tracking-[0.3em] text-primary">
                    {RIDER_LABELS[e]}
                  </dt>
                  <dd className="mt-1 text-foreground/80">
                    {piezaEnPalabras(e, rider[e]!)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {rider.otros && (
            <p className="mt-6 max-w-3xl whitespace-pre-line font-mono text-sm leading-relaxed text-muted-foreground">
              <AutoTranslate text={rider.otros} />
            </p>
          )}
        </div>
      </EpkEditableSection>
    </div>
  );
}

function FilaEquipo({
  equipo,
  campos,
  set,
  disabled,
}: {
  equipo: RiderEquipo;
  campos: Record<string, string>;
  set: (k: string) => (v: string) => void;
  disabled: boolean;
}) {
  const ej = RIDER_EJEMPLOS[equipo];
  const conCantidad = RIDER_LLEVA_CANTIDAD[equipo];
  return (
    <div>
      <span className="font-mono text-[10px] tracking-[0.3em] text-primary">
        {RIDER_LABELS[equipo]}
      </span>
      <div className={`mt-2 grid gap-3 ${conCantidad ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <Field
          label="MARCA"
          value={campos[`${equipo}.marca`] ?? ""}
          onChange={set(`${equipo}.marca`)}
          placeholder={ej.marca}
          disabled={disabled}
        />
        <Field
          label="MODELO"
          value={campos[`${equipo}.modelo`] ?? ""}
          onChange={set(`${equipo}.modelo`)}
          placeholder={ej.modelo}
          disabled={disabled}
        />
        {conCantidad && (
          <Field
            label={`CANTIDAD (1–${RIDER_MAX_CANTIDAD})`}
            type="number"
            value={campos[`${equipo}.cantidad`] ?? ""}
            onChange={set(`${equipo}.cantidad`)}
            placeholder="2"
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}
