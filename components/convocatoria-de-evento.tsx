"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Users, Lock, Globe } from "lucide-react";
import { Field, TextAreaField } from "./epk-editable-section";
import type { ConvocatoriaDeEvento } from "@/lib/convocatorias-read";

/**
 * LA CONVOCATORIA DE UN EVENTO, EN EL PANEL DE SU DUEÑO (§7).
 *
 * Cuelga de MisEventos, dentro de /perfil?panel=colectivo. NO hay página de evento —ni pública
 * ni de admin, medido listando app/**\/page.tsx— así que esto va donde el dueño ya administra
 * sus eventos. Inventarle una página sería darle un lugar nuevo que buscar.
 *
 * ============================================================
 * TRES ESTADOS, Y EL CERRADO NO ES UN VACÍO
 * ============================================================
 *
 * SIN CONVOCATORIA  un botón para abrirla.
 * ABIERTA           el conteo, el cierre, y la lista de postulantes con sus acciones.
 * CERRADA           el histórico, de solo lectura.
 *
 * El tercero existe porque una convocatoria cerrada SIGUE siendo la respuesta a "¿a quién le
 * dije que sí?". Esconderla al cerrarla dejaría al dueño sin forma de saberlo, y la fila está
 * ahí justamente para que esa pregunta tenga respuesta.
 *
 * ============================================================
 * `abierta` ES DERIVADO, ASÍ QUE EL BOTÓN DE CERRAR PUEDE NO ESTAR
 * ============================================================
 *
 * Una convocatoria a la que se le pasó cierra_en está cerrada DE HECHO aunque cerrada_en siga
 * en NULL, porque el barrido todavía no corrió. En ese estado se muestra como cerrada y sin
 * botón: ofrecer "cerrar" algo que ya no acepta postulaciones sería ofrecer una acción que no
 * cambia nada de lo que el dueño está viendo.
 *
 * ============================================================
 * SIRVE IGUAL PARA UN VENUE, SIN UNA SOLA RAMA DE entity_kind
 * ============================================================
 *
 * Y está medido que hace falta: createCommunityEvent tiene una rama explícita para cuando el
 * que publica es un venue —le llena el lugar con su propio nombre— o sea que UN VENUE PUEDE
 * ORGANIZAR UN EVENTO. Un venue buscando DJs para su propia noche es exactamente lo mismo que
 * un colectivo buscándolos, y puedeAdministrarColectivo ya cubre los dos.
 *
 * Por eso esta pieza suma CERO ramas a la métrica de entity_kind, que seguía en 20 antes y
 * después. Vale decirlo porque convocatorias era una de las dos piezas que el umbral señalaba
 * como las que más lo podían empujar.
 *
 * NO confundir con el lineup, que SÍ rechaza venues: ahí la regla es que la música es de quien
 * la hace y no del lugar donde suena. Organizar y tocar son cosas distintas.
 *
 * ============================================================
 * MOBILE PRIMERO
 * ============================================================
 *
 * Las acciones son hojas que se abren en el flujo y no modales centrados; los textos que
 * escribe el DJ se recortan a tres líneas con un VER MÁS; los postulantes son tarjetas
 * apiladas y nunca una tabla; y los botones son de al menos 44px de alto.
 */

type Props = {
  eventId: number;
  eventTitle: string;
  /** El día del evento, para el tope del input de cierre. */
  eventDate: string;
  convocatoria: ConvocatoriaDeEvento | null;
};

export function ConvocatoriaDeEventoPanel({
  eventId,
  eventTitle,
  eventDate,
  convocatoria,
}: Props) {
  const router = useRouter();
  const [abriendo, setAbriendo] = useState(false);
  const [viendo, setViendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** El formulario de abrir. */
  const [cupos, setCupos] = useState("");
  const [cierraEn, setCierraEn] = useState("");
  const [nota, setNota] = useState("");
  const [publica, setPublica] = useState(false);

  async function pedir(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return null;
      }
      return d as Record<string, unknown>;
    } catch {
      setError("No se pudo conectar. Probá de nuevo.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function abrir() {
    const d = await pedir("/api/convocatorias", "POST", {
      eventId,
      cupos: cupos || undefined,
      /**
       * El input es un datetime-local sin zona, así que se le pega el offset de Bogotá antes de
       * mandarlo. Sin eso el navegador lo manda en la zona del dispositivo y una convocatoria
       * abierta desde otro país cerraría a otra hora.
       */
      cierraEn: cierraEn ? `${cierraEn}:00-05:00` : undefined,
      nota: nota || undefined,
      visibilidad: publica ? "publica" : "djs",
    });
    if (d) {
      setAbriendo(false);
      setCupos("");
      setCierraEn("");
      setNota("");
      setPublica(false);
      router.refresh();
    }
  }

  async function cerrar() {
    const pendientes = (convocatoria?.postulaciones ?? []).filter((p) => !p.resultado).length;
    /**
     * LA CONFIRMACIÓN DICE EL NÚMERO, y no es cortesía: cerrar con pendientes adentro les
     * responde a esa gente de una, y el write path las rechaza en la misma transacción. Un
     * "¿seguro?" sin el número esconde justo lo que importa de la decisión.
     */
    const texto =
      pendientes > 0
        ? `Cerrar la convocatoria de ${eventTitle} va a RECHAZAR ${pendientes} postulación(es) ` +
          `que todavía no respondiste, y se les va a avisar. ¿Cerrar igual?`
        : `¿Cerrar la convocatoria de ${eventTitle}? No tiene postulaciones sin responder.`;
    if (!window.confirm(texto)) return;
    const d = await pedir("/api/convocatorias", "PATCH", {
      callId: convocatoria!.id,
      accion: "cerrar",
    });
    if (d) {
      const n = Number(d.rechazadas ?? 0);
      setAviso(
        n > 0
          ? `Cerrada. Se rechazaron ${n} postulación(es) pendiente(s) y se les avisó.`
          : "Cerrada."
      );
      router.refresh();
    }
  }

  async function resolver(appId: number, accion: "aceptar" | "rechazar" | "cancelar") {
    let motivo: string | null = null;

    if (accion === "cancelar") {
      /** El motivo es OBLIGATORIO al cancelar, y lo exige también el write path y un CHECK. */
      motivo = window.prompt(
        "¿Por qué cancelás la participación? El DJ ya tiene la fecha anunciada, así que esto " +
          "se le avisa con tu motivo."
      );
      if (!motivo || !motivo.trim()) {
        setError("Sin motivo no se cancela: el DJ tiene derecho a saber por qué.");
        return;
      }
    } else if (accion === "rechazar") {
      /** Opcional, y se dice que lo es: un motivo obligatorio hace que nadie resuelva. */
      motivo = window.prompt("Motivo (opcional, lo ve el DJ). Dejalo vacío si preferís.") ?? null;
    }

    const d = await pedir("/api/postulaciones", "PATCH", {
      appId,
      accion,
      ...(motivo ? { motivo } : {}),
    });
    if (d) {
      if (accion === "aceptar") {
        /**
         * `reemplazo` es lo que explica por qué el lineup se ve igual: la fila del flyer quedó
         * VINCULADA en vez de aparecer una nueva. Sin este aviso, aceptar parece no haber hecho
         * nada.
         */
        setAviso(
          d.reemplazo
            ? "Aceptado. Ya estaba en el lineup por su nombre del flyer, así que esa fila quedó vinculada a su perfil."
            : "Aceptado y agregado al final del lineup."
        );
      } else if (accion === "cancelar") {
        setAviso("Participación cancelada. Se lo avisamos con tu motivo y salió del lineup.");
      } else {
        setAviso("Rechazada. Se le avisó.");
      }
      router.refresh();
    }
  }

  const pendientes = (convocatoria?.postulaciones ?? []).filter((p) => !p.resultado);
  const resueltas = (convocatoria?.postulaciones ?? []).filter((p) => p.resultado);

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      {error && (
        <p className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {aviso && (
        <p className="mb-2 rounded border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          {aviso}
        </p>
      )}

      {/* ---------- SIN CONVOCATORIA ---------- */}
      {!convocatoria && !abriendo && (
        <button
          type="button"
          onClick={() => setAbriendo(true)}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded border border-border px-3 text-sm font-semibold hover:bg-muted"
        >
          <Megaphone className="h-4 w-4" />
          ABRIR CONVOCATORIA
        </button>
      )}

      {abriendo && (
        <div className="flex flex-col gap-3 rounded border border-border bg-muted/30 p-3">
          <p className="text-sm font-semibold">CONVOCATORIA PARA {eventTitle.toUpperCase()}</p>
          <Field
            label="Cupos (opcional)"
            value={cupos}
            onChange={setCupos}
            type="number"
            placeholder="2"
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              Cierra el (opcional)
            </span>
            <input
              type="datetime-local"
              value={cierraEn}
              /**
               * EL TOPE ES EL DÍA DEL EVENTO, y lo pone el input además del servidor. El servidor
               * es la garantía; esto es para que el dueño no tenga que descubrir la regla con un
               * error. Cerrar el mismo día de la fiesta vale, así que el máximo es 23:59 de ese
               * día y no su medianoche.
               */
              max={`${eventDate}T23:59`}
              onChange={(e) => setCierraEn(e.target.value)}
              className="min-h-[44px] rounded border border-border bg-background px-3 text-sm"
            />
          </label>
          {/**
           * SIN placeholder, porque TextAreaField no lo acepta — y no se lo agrego de paso: el
           * ejemplo de qué escribir va en la etiqueta, que es donde el DJ también lo va a leer.
           */}
          <TextAreaField
            label="Qué buscás (opcional) — ej: alguien de hard groove para abrir, 90 minutos"
            value={nota}
            onChange={setNota}
            rows={3}
          />

          {/**
           * LA VISIBILIDAD, CON SU CONSECUENCIA ESCRITA AL LADO.
           *
           * No alcanza con rotular las dos opciones: el dueño tiene que poder ver qué cuenta
           * cada una. "Pública" dice a cualquiera que el lineup no está cerrado, y eso es una
           * decisión suya y no un detalle de la plataforma.
           */}
          <fieldset className="flex flex-col gap-2 rounded border border-border/60 p-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quién la ve en /eventos
            </legend>
            <label className="flex min-h-[44px] items-start gap-2 text-sm">
              <input
                type="radio"
                name={`visib-${eventId}`}
                checked={!publica}
                onChange={() => setPublica(false)}
                className="mt-1"
              />
              <span>
                <span className="flex items-center gap-1 font-semibold">
                  <Lock className="h-3 w-3" /> Solo DJs
                </span>
                <span className="text-xs text-muted-foreground">
                  La ven quienes tienen perfil de artista, o sea quienes se pueden postular.
                </span>
              </span>
            </label>
            <label className="flex min-h-[44px] items-start gap-2 text-sm">
              <input
                type="radio"
                name={`visib-${eventId}`}
                checked={publica}
                onChange={() => setPublica(true)}
                className="mt-1"
              />
              <span>
                <span className="flex items-center gap-1 font-semibold">
                  <Globe className="h-3 w-3" /> Pública
                </span>
                <span className="text-xs text-muted-foreground">
                  La ve cualquiera. Le da más alcance, y también dice que el lineup todavía no
                  está cerrado.
                </span>
              </span>
            </label>
          </fieldset>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={abrir}
              disabled={busy}
              className="min-h-[44px] flex-1 rounded bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? "ABRIENDO..." : "ABRIR"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAbriendo(false);
                setError(null);
              }}
              className="min-h-[44px] flex-1 rounded border border-border px-3 text-sm"
            >
              CANCELAR
            </button>
          </div>
        </div>
      )}

      {/* ---------- ABIERTA O CERRADA ---------- */}
      {convocatoria && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-primary" />
            <span className="font-semibold">
              {convocatoria.postulaciones.length} POSTULACIÓN
              {convocatoria.postulaciones.length === 1 ? "" : "ES"}
            </span>
            {convocatoria.abierta ? (
              <>
                <span className="text-muted-foreground">· abierta</span>
                {convocatoria.cierraEn && (
                  <span className="text-muted-foreground">
                    · cierra el {convocatoria.cierraEn.slice(0, 10)}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {convocatoria.visibilidad === "publica" ? (
                    <>
                      <Globe className="h-3 w-3" /> pública
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3" /> solo DJs
                    </>
                  )}
                </span>
              </>
            ) : (
              /**
               * Y SE DISTINGUE QUIÉN LA CERRÓ. cerradaPor en NULL con cerradaEn puesta significa
               * que la cerró el barrido al vencer, no una persona — y eso es información, no un
               * hueco.
               */
              <span className="text-muted-foreground">
                · cerrada
                {convocatoria.cerradaEn && !convocatoria.cerradaPor
                  ? " sola, al vencer"
                  : convocatoria.cerradaPor
                    ? ` por ${convocatoria.cerradaPor}`
                    : " de hecho: se le pasó la fecha"}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setViendo((v) => !v)}
              className="min-h-[44px] flex-1 rounded border border-border px-3 text-sm font-semibold hover:bg-muted"
            >
              {viendo ? "OCULTAR" : "VER POSTULANTES"}
            </button>
            {convocatoria.abierta && (
              <button
                type="button"
                onClick={cerrar}
                disabled={busy}
                className="min-h-[44px] flex-1 rounded border border-border px-3 text-sm disabled:opacity-50"
              >
                CERRAR CONVOCATORIA
              </button>
            )}
          </div>

          {viendo && (
            <div className="flex flex-col gap-2">
              {convocatoria.postulaciones.length === 0 && (
                <p className="text-sm text-muted-foreground">Todavía no se postuló nadie.</p>
              )}
              {[...pendientes, ...resueltas].map((p) => (
                <Postulante
                  key={p.id}
                  p={p}
                  abierta={convocatoria.abierta}
                  busy={busy}
                  onResolver={resolver}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * UNA TARJETA POR POSTULANTE. Apilada y no una fila de tabla: en un teléfono una tabla de seis
 * columnas se vuelve ilegible o scrollea horizontal, y lo que el dueño necesita leer entero es
 * justamente el texto largo.
 *
 * EL GÉNERO Y NO EL DISTRITO: el sistema de diez distritos con color se borró, así que el
 * distrito dejó de decirle algo a quien mira.
 *
 * EL LINK AL EPK ABRE EN PESTAÑA NUEVA. El dueño decide mirando el perfil, así que no puede
 * perder la lista para verlo — y menos en un teléfono, donde volver significa recargar el panel
 * entero y perder lo que tenía abierto.
 */
function Postulante({
  p,
  abierta,
  busy,
  onResolver,
}: {
  p: ConvocatoriaDeEvento["postulaciones"][number];
  abierta: boolean;
  busy: boolean;
  onResolver: (id: number, accion: "aceptar" | "rechazar" | "cancelar") => void;
}) {
  const [completo, setCompleto] = useState(false);
  const largo = p.mensaje.length > 180 || p.disponibilidad.length > 90;

  return (
    <div className="rounded border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        {p.artistPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.artistPhoto}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-full bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p.artistName}</p>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.artistGenre}</p>
          <a
            href={`/artistas/${p.artistSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline"
          >
            VER SU PERFIL
          </a>
        </div>
        {p.resultado && (
          <span className="shrink-0 rounded border border-border px-2 py-0.5 text-xs uppercase">
            {p.resultado}
          </span>
        )}
      </div>

      <div className={`mt-2 text-sm ${completo ? "" : "line-clamp-3"}`}>
        <p>{p.mensaje}</p>
        <p className="mt-1 text-muted-foreground">Disponible: {p.disponibilidad}</p>
        {p.motivo && <p className="mt-1 text-muted-foreground">Motivo: {p.motivo}</p>}
      </div>
      {largo && (
        <button
          type="button"
          onClick={() => setCompleto((c) => !c)}
          className="mt-1 text-xs underline"
        >
          {completo ? "VER MENOS" : "VER MÁS"}
        </button>
      )}

      {/**
       * LAS ACCIONES DEPENDEN DEL ESTADO, y las que no se pueden hacer NO SE MUESTRAN en vez de
       * mostrarse deshabilitadas. Un botón gris invita a preguntarse por qué; uno ausente no.
       *
       * Una pendiente en convocatoria CERRADA no tiene acciones: el barrido la va a rechazar, y
       * ofrecer aceptarla sería ofrecer algo que el write path niega.
       */}
      {!p.resultado && abierta && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => onResolver(p.id, "aceptar")}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            ACEPTAR
          </button>
          <button
            type="button"
            onClick={() => onResolver(p.id, "rechazar")}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded border border-border px-3 text-sm disabled:opacity-50"
          >
            RECHAZAR
          </button>
        </div>
      )}

      {p.resultado === "aceptada" && (
        <button
          type="button"
          onClick={() => onResolver(p.id, "cancelar")}
          disabled={busy}
          className="mt-2 min-h-[44px] w-full rounded border border-destructive/40 px-3 text-sm text-destructive disabled:opacity-50"
        >
          CANCELAR PARTICIPACIÓN
        </button>
      )}
    </div>
  );
}
