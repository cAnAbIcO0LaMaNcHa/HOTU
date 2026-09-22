"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { FranjaCensura } from "./franja-censura";
import { Field, TextAreaField } from "./epk-editable-section";
import type { MiEvento } from "@/lib/db";

/**
 * MIS EVENTOS — el organizador corrige y baja los suyos (tanda 5 §4).
 *
 * ============================================================
 * ESTO ES LO QUE REEMPLAZA AL CMS DEL ADMIN
 * ============================================================
 *
 * Hasta esta tanda, un evento publicado con la fecha mal lo arreglaba el
 * admin. El admin dejó de editar contenido ajeno, así que si esto no
 * existiera el evento quedaría inmutable para siempre y el sitio
 * terminaría peor que antes — que es exactamente lo que la regla de la
 * transición prohíbe.
 *
 * ============================================================
 * BORRAR Y "QUE LO BAJEN" NO SON LO MISMO
 * ============================================================
 *
 * Acá se borra: la fila desaparece. Lo otro —bajarlo del sitio sin
 * borrarlo, con un motivo— es censura, la hace un moderador y el
 * organizador no la puede deshacer. Por eso un evento censurado se
 * muestra con su franja y SIGUE siendo editable: la censura trae un
 * motivo, el motivo suele ser algo que se arregla, y editar no lo
 * devuelve al sitio.
 *
 * Y no se borra lo que ya se vendió. El server lo niega con el número de
 * boletas; acá el botón directamente no aparece, para no ofrecer algo
 * que va a fallar.
 */
export function MisEventos({ eventos }: { eventos: MiEvento[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);

  if (eventos.length === 0) return null;

  async function pedir(id: number, method: string, body?: unknown) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${id}`, {
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
        <CalendarDays className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">MIS EVENTOS</h2>
      </div>

      {error && (
        <p role="alert" className="mt-4 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {eventos.map((e) => (
          <div key={e.id} className="border border-border p-4">
            <FranjaCensura
              que="Este evento"
              motivo={e.censorReason}
              censuradaEn={e.censoredAt}
            />

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {e.date}
                {e.vendidas > 0 ? ` · ${e.vendidas} VENDIDA${e.vendidas === 1 ? "" : "S"}` : ""}
              </span>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {e.organizerName.toUpperCase()}
              </span>
            </div>
            <div className="mt-1 font-bold">{e.title}</div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {e.venue} · {e.city}
            </div>
            {e.lineup && (
              <div className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {e.lineup}
              </div>
            )}

            {editando === e.id ? (
              <EditorEvento
                evento={e}
                busy={busy === e.id}
                onCancelar={() => setEditando(null)}
                onGuardar={async (patch) => {
                  if (await pedir(e.id, "PATCH", patch)) setEditando(null);
                }}
              />
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === e.id}
                  onClick={() => setEditando(e.id)}
                  className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  CORREGIR
                </button>
                {/* Sin boletas vendidas. Con ellas el server lo niega, y
                    ofrecer un botón que va a fallar es peor que no
                    ofrecerlo: el organizador lo aprieta pensando que
                    puede. */}
                {e.vendidas === 0 && (
                  <button
                    type="button"
                    disabled={busy === e.id}
                    onClick={() => {
                      if (
                        confirm(
                          `Borrar "${e.title}". Desaparece del todo y no se puede deshacer. Si lo que querés es sacarlo de la agenda sin perderlo, cambiale la fecha.`
                        )
                      ) {
                        pedir(e.id, "DELETE");
                      }
                    }}
                    className="px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-primary disabled:opacity-50"
                  >
                    BORRAR
                  </button>
                )}
                {e.vendidas > 0 && (
                  <span className="self-center font-mono text-[10px] text-muted-foreground">
                    Con boletas vendidas no se borra: una boleta es prueba de un pago.
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EditorEvento({
  evento,
  busy,
  onGuardar,
  onCancelar,
}: {
  evento: MiEvento;
  busy: boolean;
  onGuardar: (patch: Record<string, string>) => void;
  onCancelar: () => void;
}) {
  const [title, setTitle] = useState(evento.title);
  const [date, setDate] = useState(evento.date);
  // datetime-local quiere "AAAA-MM-DDTHH:MM", sin zona ni segundos.
  const [endAt, setEndAt] = useState(evento.endAt ? evento.endAt.slice(0, 16) : "");
  const [venue, setVenue] = useState(evento.venue);
  const [city, setCity] = useState(evento.city);
  const [lineup, setLineup] = useState(evento.lineup);

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <Field label="NOMBRE DE LA FIESTA" value={title} onChange={setTitle} disabled={busy} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="FECHA" type="date" value={date} onChange={setDate} disabled={busy} />
        <Field
          label="CIERRA (OPCIONAL)"
          type="datetime-local"
          value={endAt}
          onChange={setEndAt}
          disabled={busy}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="LUGAR" value={venue} onChange={setVenue} disabled={busy} />
        <Field label="CIUDAD" value={city} onChange={setCity} disabled={busy} />
      </div>
      <TextAreaField label="LINE UP" value={lineup} onChange={setLineup} rows={3} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onGuardar({ title, date, endAt, venue, city, lineup })}
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
