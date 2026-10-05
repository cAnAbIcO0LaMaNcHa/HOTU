"use client";

import { useState } from "react";
import { Search } from "lucide-react";

/**
 * BUSCADOR DE FOTOS Y NOTAS DE UN ARTISTA, PARA PODER NOMBRARLAS.
 *
 * ============================================================
 * POR QUÉ EXISTE: EL id NO SE VE EN NINGÚN LADO
 * ============================================================
 *
 * Todas las demás piezas censurables se nombran por slug, y el slug está en la URL: un
 * moderador que ve /sets/mi-set ya tiene la clave. Una foto de galería se identifica por un
 * entero que no aparece ni en la página ni en la dirección, así que el formulario de censura
 * le pediría un dato que no tiene forma de averiguar. Eso no es una función incompleta, es
 * una función inusable.
 *
 * ============================================================
 * SOLO BUSCA: NO CENSURA
 * ============================================================
 *
 * Elegir una fila rellena el formulario de arriba, y la censura sigue saliendo de ahí. Podría
 * haber tenido su propio botón de bajar, y sería peor: dos caminos para censurar significan
 * dos lugares donde el motivo se valida, dos lugares donde se escribe quién lo hizo, y la
 * próxima vez que uno de los dos cambie, el otro no.
 *
 * MUESTRA LAS CENSURADAS, al revés que la página pública: para levantar una censura hay que
 * poder verla, y una cola que esconde lo que ya bajó no deja deshacer nada.
 */

type Fila = {
  id: number;
  url: string;
  etiqueta: string | null;
  censuradoEn: string | null;
  motivo: string | null;
};

export function BuscadorGaleria({
  onElegir,
}: {
  /** Rellena el formulario de censura de arriba con el tipo y el id elegidos. */
  onElegir: (tipo: "photo" | "press", id: number) => void;
}) {
  const [slug, setSlug] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ fotos: Fila[]; prensa: Fila[] } | null>(null);

  const buscar = async () => {
    const s = slug.trim();
    if (!s) return;
    setBuscando(true);
    setError(null);
    setRes(null);
    try {
      const r = await fetch(`/api/admin/moderation/galeria?slug=${encodeURIComponent(s)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? `No se pudo (HTTP ${r.status})`);
        return;
      }
      setRes({ fotos: d.fotos ?? [], prensa: d.prensa ?? [] });
    } catch {
      setError("No se pudo. Revisá la conexión.");
    } finally {
      setBuscando(false);
    }
  };

  return (
    <section>
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Search className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
          BUSCAR UNA FOTO O UNA NOTA DE PRENSA
        </h2>
      </div>
      <p className="mt-3 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
        El id de una foto no está en la URL, así que acá se buscan por artista. Elegí una y el
        formulario de arriba queda listo; el motivo lo escribís ahí.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="block min-w-[240px] flex-1">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            SLUG DEL ARTISTA
          </span>
          <input
            value={slug}
            disabled={buscando}
            onChange={(e) => setSlug(e.target.value)}
            onKeyDown={(e) => {
              /** Enter busca: obligar al mouse en un panel de moderación es fricción
               *  gratuita cuando la tarea es repetitiva. */
              if (e.key === "Enter") void buscar();
            }}
            placeholder="nombre-en-la-url"
            className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          />
        </label>
        <button
          type="button"
          onClick={() => void buscar()}
          disabled={buscando || slug.trim() === ""}
          className="border border-primary px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-primary disabled:opacity-40"
        >
          {buscando ? "BUSCANDO…" : "BUSCAR"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] text-red-400">
          {error}
        </p>
      )}

      {res && (
        <div className="mt-5 space-y-6">
          {(["fotos", "prensa"] as const).map((cual) => {
            const filas = res[cual];
            const tipo = cual === "fotos" ? ("photo" as const) : ("press" as const);
            return (
              <div key={cual}>
                <h3 className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
                  {cual === "fotos" ? "GALERÍA" : "PRENSA"} ({filas.length})
                </h3>
                {filas.length === 0 ? (
                  /** Un "no hay" explícito, y no una lista vacía: con una lista vacía no se
                   *  distingue "este artista no tiene fotos" de "la búsqueda no corrió". */
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    No tiene {cual === "fotos" ? "fotos" : "notas"}.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {filas.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center gap-3 border border-border px-3 py-2"
                      >
                        <span className="font-mono text-[11px] text-primary">#{f.id}</span>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate font-mono text-[11px] underline hover:text-primary"
                        >
                          {f.etiqueta || f.url}
                        </a>
                        {f.censuradoEn ? (
                          <span className="font-mono text-[10px] tracking-widest text-red-400">
                            CENSURADA{f.motivo ? ` — ${f.motivo}` : ""}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onElegir(tipo, f.id)}
                          className="font-mono text-[10px] tracking-[0.2em] text-primary underline"
                        >
                          USAR ESTE ID
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
