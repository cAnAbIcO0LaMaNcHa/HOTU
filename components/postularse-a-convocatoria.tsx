"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Users } from "lucide-react";
import { TextAreaField } from "./epk-editable-section";
import type { ConvocatoriaAbierta } from "@/lib/convocatorias-read";

/**
 * EL DISTINTIVO DE CONVOCATORIA EN LA TARJETA DEL EVENTO, Y LA POSTULACIÓN (§7).
 *
 * ============================================================
 * VA EN /eventos Y NO EN UNA PÁGINA PROPIA
 * ============================================================
 *
 * Una convocatoria abierta es un evento que YA está en esa lista. Una página /convocatorias
 * aparte partiría la escena en dos listas que hay que mirar las dos, y la segunda siempre se
 * mira menos. Acá el DJ se entera mientras hace lo que ya hacía: ver qué hay.
 *
 * ============================================================
 * LO QUE NO SE MUESTRA, Y POR QUÉ NO ES LO MISMO QUE DESHABILITARLO
 * ============================================================
 *
 * SIN PERFIL DE DJ        el distintivo puede aparecer (si la convocatoria es pública) pero el
 *                         botón invita a crear el perfil, no a postularse. Un botón que falla
 *                         es peor que uno que explica.
 * YA ESTÁ EN EL LINEUP    no hay botón. El write path lo niega con 409, pero ofrecerle una
 *                         puerta cerrada es hacerle descubrir la regla con un error.
 * YA SE POSTULÓ           no hay botón, y se le dice que su postulación está esperando.
 *
 * El caso de "ya está en el lineup" NO se deriva acá: llega como prop desde el server, que es
 * el único que puede saberlo sin exponerle a un visitante quién está programado.
 */

type Props = {
  convocatoria: ConvocatoriaAbierta;
  /** El slug del perfil de artista de quien mira. null = no tiene perfil de DJ. */
  artistSlug: string | null;
  /** Ya tiene una postulación sin resolver en esta convocatoria. */
  yaSePostulo: boolean;
  /** Ya está en el lineup de este evento. */
  yaEnLineup: boolean;
};

export function PostularseAConvocatoria({
  convocatoria,
  artistSlug,
  yaSePostulo,
  yaEnLineup,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [disponibilidad, setDisponibilidad] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function postularse() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/postulaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: convocatoria.id,
          artistSlug,
          mensaje,
          disponibilidad,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return;
      }
      setListo(true);
      setAbierto(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Megaphone className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono font-semibold tracking-widest text-primary">
          CONVOCATORIA ABIERTA
        </span>
        {convocatoria.cupos !== null && (
          <span className="text-muted-foreground">
            · {convocatoria.cupos} cupo{convocatoria.cupos === 1 ? "" : "s"}
          </span>
        )}
        {convocatoria.cierraEn && (
          <span className="text-muted-foreground">
            · cierra el {convocatoria.cierraEn.slice(0, 10)}
          </span>
        )}
        {/**
         * EL CONTEO DE POSTULACIONES ES PÚBLICO a propósito: es lo que le deja a un DJ decidir
         * si vale la pena. "Dos cupos y catorce anotados" es información útil, y esconderla no
         * protege a nadie — el que ya se postuló sabe que hay competencia igual.
         */}
        {convocatoria.postulaciones > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Users className="h-3 w-3" />
            {convocatoria.postulaciones}
          </span>
        )}
      </div>

      {convocatoria.nota && (
        <p className="mt-1 text-xs text-muted-foreground">{convocatoria.nota}</p>
      )}

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      {listo && (
        <p className="mt-2 text-xs">
          Tu postulación quedó anotada. La vas a ver en tu perfil, y ahí te enterás de la
          respuesta.
        </p>
      )}

      {!listo && (
        <>
          {/* SIN PERFIL DE DJ: se explica y se ofrece el camino, no un botón que falla. */}
          {!artistSlug && (
            <p className="mt-2 text-xs text-muted-foreground">
              Para postularte hace falta un perfil de DJ.{" "}
              <a href="/perfil?panel=artista" className="underline">
                Creá el tuyo
              </a>
              .
            </p>
          )}

          {artistSlug && yaEnLineup && (
            <p className="mt-2 text-xs text-muted-foreground">Ya estás en el lineup de esta fiesta.</p>
          )}

          {artistSlug && !yaEnLineup && yaSePostulo && (
            <p className="mt-2 text-xs text-muted-foreground">
              Ya te postulaste. Tu postulación está esperando respuesta.
            </p>
          )}

          {artistSlug && !yaEnLineup && !yaSePostulo && !abierto && (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="mt-2 min-h-[44px] w-full rounded border border-primary px-3 text-xs font-semibold tracking-widest text-primary hover:bg-primary/10"
            >
              POSTULARME
            </button>
          )}

          {abierto && (
            <div className="mt-2 flex flex-col gap-2">
              {/**
               * LOS DOS CAMPOS SON OBLIGATORIOS, y se dice en la etiqueta en vez de dejar que el
               * servidor lo rechace. El write path los exige igual —es la garantía— pero
               * descubrir un campo obligatorio con un error es peor que leerlo antes.
               */}
              <TextAreaField
                label="Tu mensaje (obligatorio) — por qué querés tocar acá"
                value={mensaje}
                onChange={setMensaje}
                rows={3}
              />
              <TextAreaField
                label="Tu disponibilidad (obligatoria) — a qué hora podés"
                value={disponibilidad}
                onChange={setDisponibilidad}
                rows={2}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={postularse}
                  disabled={busy || !mensaje.trim() || !disponibilidad.trim()}
                  className="min-h-[44px] flex-1 rounded bg-primary px-3 text-xs font-semibold tracking-widest text-primary-foreground disabled:opacity-50"
                >
                  {busy ? "ENVIANDO..." : "ENVIAR POSTULACIÓN"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAbierto(false);
                    setError(null);
                  }}
                  className="min-h-[44px] flex-1 rounded border border-border px-3 text-xs tracking-widest"
                >
                  CANCELAR
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
