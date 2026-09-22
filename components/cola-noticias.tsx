"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Check, Clock, Newspaper } from "lucide-react";
import type { NoticiaEnRevision } from "@/lib/db";

/**
 * La cola de noticias de la comunidad (tanda 5 §4).
 *
 * Espejo de la cola de perfiles de DJ, y a propósito: quien modera hace
 * las dos cosas en la misma sesión, y dos pantallas que se parecen se
 * aprenden una sola vez.
 *
 * ============================================================
 * SE LEE ENTERA ACÁ, SIN ABRIR NADA
 * ============================================================
 *
 * Una noticia es un título y un texto: cabe. Mandar al moderador a otra
 * pantalla para leer lo que tiene que juzgar garantiza que no la lea.
 *
 * ============================================================
 * RECHAZAR PIDE MOTIVO ANTES DE DEJAR APRETAR
 * ============================================================
 *
 * El botón no hace nada hasta que haya texto. Es la tercera guarda —la
 * base tiene un CHECK y el lib valida— y existe porque es la única que
 * se ve: las otras dos aparecen como un error después del click, y para
 * entonces el moderador ya decidió que no iba a escribir nada.
 *
 * El motivo es lo ÚNICO que recibe el autor. Un "no" sin explicación es
 * una noticia que nadie corrige nunca.
 */
export function ColaNoticias({ pendientes }: { pendientes: NoticiaEnRevision[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motivos, setMotivos] = useState<Record<number, string>>({});

  if (pendientes.length === 0) {
    return (
      <div className="mt-10 border border-dashed border-border p-8 text-center">
        <Check className="mx-auto h-5 w-5 text-primary" />
        <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-muted-foreground">
          NO HAY NADA ESPERANDO
        </p>
        <p className="mx-auto mt-2 max-w-md font-mono text-[10px] leading-relaxed text-muted-foreground">
          Cuando un colectivo o un venue mande una noticia, aparece acá. Mientras
          tanto no hay nada que hacer.
        </p>
      </div>
    );
  }

  async function decidir(id: number, action: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/news/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action } : { action, note: motivos[id] ?? "" }
        ),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo. Revisá la conexión.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8 space-y-4">
      {error && (
        <p role="alert" className="font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      {pendientes.map((n) => {
        const motivo = motivos[n.id] ?? "";
        const puedeRechazar = motivo.trim().length >= 10;
        return (
          <article key={n.id} className="border-chrome p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-primary">
                <Newspaper className="h-3 w-3" /> {n.tag}
              </span>
              <span className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground">
                <Clock className="h-3 w-3" />
                {n.dias === 0 ? "HOY" : `HACE ${n.dias} DÍA${n.dias === 1 ? "" : "S"}`}
              </span>
            </div>

            <h2 className="mt-4 text-xl font-bold">{n.title}</h2>

            <div className="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground">
              DE{" "}
              <Link
                href={`${n.autorEsVenue ? "/venues" : "/colectivos"}/${n.autorSlug}`}
                className="text-primary hover:underline"
              >
                {n.autorNombre.toUpperCase()}
              </Link>
              {" · "}
              {/* Contexto para leer el texto, no una regla que decida:
                  la primera de alguien que recién llega no se lee igual
                  que la décima de quien viene publicando bien. */}
              {n.aprobadasDelAutor === 0
                ? "PRIMERA QUE MANDA"
                : `YA LE APROBAMOS ${n.aprobadasDelAutor}`}
              {" · FECHA "}
              {n.date}
            </div>

            {/* Entera, sin recortar: es lo que hay que juzgar. */}
            <p className="mt-4 whitespace-pre-wrap font-mono text-[12px] leading-relaxed">
              {n.excerpt}
            </p>

            <div className="mt-5 border-t border-border pt-4">
              <label className="block">
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                  MOTIVO, SI LA RECHAZÁS
                </span>
                <textarea
                  value={motivo}
                  rows={2}
                  disabled={busy === n.id}
                  onChange={(e) => setMotivos((m) => ({ ...m, [n.id]: e.target.value }))}
                  placeholder="Qué tiene que corregir para que se pueda publicar"
                  className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-primary disabled:opacity-50"
                />
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy === n.id}
                  onClick={() => decidir(n.id, "approve")}
                  className="surface-chrome sheen inline-flex items-center gap-2 px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-40"
                >
                  <Check className="h-3 w-3" />
                  {busy === n.id ? "..." : "APROBAR Y PUBLICAR"}
                </button>
                <button
                  type="button"
                  disabled={busy === n.id || !puedeRechazar}
                  onClick={() => decidir(n.id, "reject")}
                  className="inline-flex items-center gap-2 border border-border px-4 py-2.5 font-mono text-[11px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  <AlertCircle className="h-3 w-3" /> RECHAZAR
                </button>
                {!puedeRechazar && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Para rechazar, escribí el motivo arriba.
                  </span>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
