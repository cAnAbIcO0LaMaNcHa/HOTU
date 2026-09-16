"use client";

import { useMemo } from "react";
import { Search, X } from "lucide-react";
import type { BranchOption, TagOption } from "@/lib/db";
import { normalize } from "@/components/listing-filters";

/**
 * El selector de género, compartido por el alta y la edición.
 *
 * Vive acá y no dentro del formulario de alta porque la regla es una
 * sola: un branch primario, hasta 3 secundarios, de 3 a 8 tags. Dos
 * copias del selector se separan la primera vez que alguien cambia un
 * límite en una, igual que pasaría con dos copias de la validación.
 *
 * Controlado: no guarda nada ni habla con la red. Quien lo usa decide
 * qué hacer con la selección, que en el alta es parte de un formulario
 * más grande y en la edición es un PUT propio.
 *
 * EL BUSCADOR DE TAGS NO SE ENCIERRA EN LA RAMA ELEGIDA. 71 slugs viven
 * en más de un branch y electro-house vive en tres, así que un DJ de
 * TECHNO tiene que poder tomar acid-techno desde ACID. Sin búsqueda
 * muestra los de la rama, que es el caso común; apenas se escribe, mira
 * los 719 y dice de dónde viene cada uno.
 */
export type SeleccionGenero = {
  primary: string;
  secundarios: string[];
  tags: TagOption[];
};

export const MAX_SECUNDARIOS = 3;
export const MIN_TAGS = 3;
export const MAX_TAGS = 8;

export function GenrePicker({
  branches,
  tags,
  valor,
  onChange,
  buscar,
  onBuscar,
  disabled,
}: {
  branches: BranchOption[];
  tags: TagOption[];
  valor: SeleccionGenero;
  onChange: (v: SeleccionGenero) => void;
  buscar: string;
  onBuscar: (s: string) => void;
  disabled?: boolean;
}) {
  const { primary, secundarios, tags: elegidos } = valor;

  const nombreDeRama = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.code, b.name])),
    [branches]
  );

  const sugeridos = useMemo(() => {
    const q = normalize(buscar);
    const base = q
      ? tags.filter((t) => normalize(t.name).includes(q) || normalize(t.slug).includes(q))
      : tags.filter((t) => t.branchCode === primary);
    const ya = new Set(elegidos.map((t) => t.slug));
    return base.filter((t) => !ya.has(t.slug)).slice(0, 60);
  }, [buscar, tags, primary, elegidos]);

  function toggleTag(t: TagOption) {
    const ya = elegidos.some((x) => x.slug === t.slug);
    if (ya) {
      onChange({ ...valor, tags: elegidos.filter((x) => x.slug !== t.slug) });
    } else if (elegidos.length < MAX_TAGS) {
      onChange({ ...valor, tags: [...elegidos, t] });
    }
  }

  function toggleSecundario(code: string) {
    const ya = secundarios.includes(code);
    if (ya) {
      onChange({ ...valor, secundarios: secundarios.filter((c) => c !== code) });
    } else if (secundarios.length < MAX_SECUNDARIOS) {
      onChange({ ...valor, secundarios: [...secundarios, code] });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          GÉNERO PRINCIPAL
        </span>
        <select
          value={primary}
          onChange={(e) =>
            // Cambiar de rama NO borra los tags ya elegidos: muchos son
            // transversales y siguen siendo válidos. Solo se saca la rama
            // nueva de los secundarios, donde no puede estar repetida.
            onChange({
              ...valor,
              primary: e.target.value,
              secundarios: secundarios.filter((c) => c !== e.target.value),
            })
          }
          disabled={disabled}
          className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none disabled:opacity-50"
        >
          <option value="">Elegí uno</option>
          {branches.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name} · {b.category}
            </option>
          ))}
        </select>
      </div>

      {primary && (
        <div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            SECUNDARIOS (HASTA {MAX_SECUNDARIOS}, OPCIONAL)
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {branches
              .filter((b) => b.code !== primary)
              .map((b) => {
                const on = secundarios.includes(b.code);
                return (
                  <button
                    key={b.code}
                    type="button"
                    onClick={() => toggleSecundario(b.code)}
                    disabled={disabled || (!on && secundarios.length >= MAX_SECUNDARIOS)}
                    className={`border px-2 py-1 font-mono text-[10px] tracking-widest disabled:opacity-30 ${
                      on ? "border-primary text-primary" : "border-border hover:border-primary"
                    }`}
                  >
                    {b.name}
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {primary && (
        <div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            TAGS ({elegidos.length} DE {MIN_TAGS} A {MAX_TAGS})
          </span>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Los tres primeros son los principales. Buscá para encontrar tags de
            cualquier rama, no solo de la tuya: muchos viven en varias.
          </p>

          {elegidos.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {elegidos.map((t, i) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => toggleTag(t)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 border border-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary disabled:opacity-50"
                >
                  {i < MIN_TAGS && <span className="text-[8px]">★</span>}
                  {t.name}
                  {t.branchCode !== primary && (
                    <span className="text-muted-foreground">·{t.branchCode}</span>
                  )}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={buscar}
              onChange={(e) => onBuscar(e.target.value)}
              placeholder={`Buscar en los ${tags.length} tags...`}
              disabled={disabled}
              className="w-full border border-border bg-background py-2 pl-9 pr-3 font-mono text-xs focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="mt-3 flex max-h-64 flex-wrap gap-2 overflow-y-auto">
            {sugeridos.map((t) => (
              <button
                key={`${t.slug}-${t.branchCode}`}
                type="button"
                onClick={() => toggleTag(t)}
                disabled={disabled || elegidos.length >= MAX_TAGS}
                className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary disabled:opacity-30"
              >
                {t.name}
                {t.branchCode !== primary && (
                  <span className="ml-1 text-muted-foreground">·{nombreDeRama[t.branchCode]}</span>
                )}
              </button>
            ))}
            {sugeridos.length === 0 && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {buscar ? "Nada coincide." : "Elegí un género principal."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
