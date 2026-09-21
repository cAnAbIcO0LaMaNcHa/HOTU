"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Check, Clock, Eye, Newspaper } from "lucide-react";
import { Field, TextAreaField } from "./epk-editable-section";
import type { MiNoticia } from "@/lib/db";

/**
 * MIS NOTICIAS — la bandeja del autor (tanda 5 §3).
 *
 * ============================================================
 * ESTA ES LA NOTIFICACIÓN. NO HAY UN SISTEMA DE AVISOS APARTE
 * ============================================================
 *
 * Cuando a una noticia la rechazan, el motivo se lee ACÁ, pegado a la
 * noticia rechazada y con el botón para corregirla al lado. Es el mismo
 * criterio que la franja de revisión del press kit: el aviso que te
 * saca de contexto para decirte que algo pasó te obliga a volver a
 * buscar dónde pasó.
 *
 * Y por eso el editor está acá adentro y no en otra pantalla: un motivo
 * de rechazo sin forma de corregir es un cartel, no una conversación.
 *
 * ============================================================
 * LOS CUATRO ESTADOS SE DICEN, NO SE INSINÚAN
 * ============================================================
 *
 * BORRADOR es "solo lo ves vos". EN REVISIÓN es "no lo toques, lo están
 * leyendo". RECHAZADA trae el motivo. PUBLICADA linkea al sitio y avisa
 * que ya no se edita — que es la razón de ser de la cola, no un
 * capricho.
 */
export function MisNoticias({ noticias }: { noticias: MiNoticia[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);

  if (noticias.length === 0) return null;

  async function pedir(id: number, ruta: string, method: string, body?: unknown) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(ruta, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("No se pudo. Revisá la conexión.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-16">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <Newspaper className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">MIS NOTICIAS</h2>
      </div>

      {error && (
        <p role="alert" className="mt-4 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {noticias.map((n) => (
          <div key={n.id} className="border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              {/* MANDA publicada, NO review_status. Son dos preguntas
                  distintas y se pueden contradecir: una noticia
                  publicada desde /admin/noticias conserva el
                  review_status que tenía, y el panel llegó a decir "no
                  se aprobó todavía, solo la ves vos" sobre algo que
                  estaba en portada. Lo que el autor necesita saber
                  primero es si se ve o no. */}
              <Estado estado={n.publicada ? "aprobado" : n.reviewStatus} />
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {n.tag} · {n.date}
                {noticias.some((o) => o.authorSlug !== n.authorSlug)
                  ? ` · ${n.authorName.toUpperCase()}`
                  : ""}
              </span>
            </div>

            <div className="mt-2 font-bold">{n.title}</div>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {n.excerpt.length > 220 ? `${n.excerpt.slice(0, 220)}...` : n.excerpt}
            </p>

            {/* El motivo del rechazo, entero y sin recortar. */}
            {!n.publicada && n.reviewStatus === "rechazado" && n.reviewNote && (
              <blockquote className="mt-3 border-l-2 border-primary pl-4 font-mono text-[12px] leading-relaxed">
                {n.reviewNote}
              </blockquote>
            )}

            {editando === n.id && !n.publicada ? (
              <EditorNoticia
                noticia={n}
                busy={busy === n.id}
                onCancelar={() => setEditando(null)}
                onGuardar={async (patch) => {
                  const bien = await pedir(n.id, `/api/news/${n.id}`, "PATCH", patch);
                  if (bien) setEditando(null);
                }}
              />
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {!n.publicada &&
                  (n.reviewStatus === "borrador" || n.reviewStatus === "rechazado") && (
                  <>
                    <button
                      type="button"
                      disabled={busy === n.id}
                      onClick={() => pedir(n.id, `/api/news/${n.id}/review`, "PATCH", { action: "submit" })}
                      className="surface-chrome sheen px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
                    >
                      {n.reviewStatus === "rechazado" ? "MANDAR DE NUEVO" : "MANDAR A REVISIÓN"}
                    </button>
                    <button
                      type="button"
                      disabled={busy === n.id}
                      onClick={() => setEditando(n.id)}
                      className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      CORREGIR
                    </button>
                    <button
                      type="button"
                      disabled={busy === n.id}
                      onClick={() => {
                        if (
                          confirm(
                            `Borrar "${n.title}". No se puede deshacer, y todavía no la vio nadie más que vos.`
                          )
                        ) {
                          pedir(n.id, `/api/news/${n.id}`, "DELETE");
                        }
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-primary disabled:opacity-50"
                    >
                      BORRAR
                    </button>
                  </>
                )}

                {!n.publicada && n.reviewStatus === "en_revision" && (
                  <button
                    type="button"
                    disabled={busy === n.id}
                    onClick={() => pedir(n.id, `/api/news/${n.id}/review`, "PATCH", { action: "withdraw" })}
                    className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    RETIRAR Y SEGUIR EDITANDO
                  </button>
                )}

                {n.publicada && (
                  <Link
                    href="/noticias"
                    className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    VERLA EN EL SITIO
                  </Link>
                )}
              </div>
            )}

            <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {n.publicada &&
                "Publicada. Ya no se edita: si hay que corregir algo, se publica otra."}
              {!n.publicada &&
                n.reviewStatus === "borrador" &&
                "Solo la ves vos. Mandala cuando esté lista."}
              {!n.publicada &&
                n.reviewStatus === "en_revision" &&
                "La está leyendo alguien del equipo. Mientras tanto no se edita: quien la revisa tiene que ver lo que mandaste."}
              {!n.publicada &&
                n.reviewStatus === "rechazado" &&
                "Corregí lo que dice arriba y mandala de nuevo. No hay límite de intentos."}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Estado({ estado }: { estado: MiNoticia["reviewStatus"] }) {
  const mapa = {
    borrador: { Icono: Eye, texto: "BORRADOR · SOLO LO VES VOS" },
    en_revision: { Icono: Clock, texto: "EN REVISIÓN" },
    rechazado: { Icono: AlertCircle, texto: "NO SE APROBÓ TODAVÍA" },
    aprobado: { Icono: Check, texto: "PUBLICADA" },
  } as const;
  const { Icono, texto } = mapa[estado];
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-primary">
      <Icono className="h-3 w-3" /> {texto}
    </span>
  );
}

/** Corregir una propia sin publicar, ahí mismo donde se lee el motivo. */
function EditorNoticia({
  noticia,
  busy,
  onGuardar,
  onCancelar,
}: {
  noticia: MiNoticia;
  busy: boolean;
  onGuardar: (patch: { title: string; tag: string; date: string; excerpt: string }) => void;
  onCancelar: () => void;
}) {
  const [title, setTitle] = useState(noticia.title);
  const [tag, setTag] = useState(noticia.tag);
  const [date, setDate] = useState(noticia.date);
  const [excerpt, setExcerpt] = useState(noticia.excerpt);

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <Field label="TÍTULO" value={title} onChange={setTitle} disabled={busy} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ETIQUETA" value={tag} onChange={setTag} disabled={busy} />
        <Field label="FECHA" type="date" value={date} onChange={setDate} disabled={busy} />
      </div>
      <TextAreaField label="LA NOTICIA" value={excerpt} onChange={setExcerpt} rows={6} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onGuardar({ title, tag, date, excerpt })}
          className="surface-chrome sheen px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em] disabled:opacity-50"
        >
          {busy ? "GUARDANDO..." : "GUARDAR"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancelar}
          className="px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-primary disabled:opacity-50"
        >
          CANCELAR
        </button>
      </div>
    </div>
  );
}
