/** Postgres DATE columns come back as Date objects; normalise to YYYY-MM-DD. */
export function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Format a date as DD.MM.YY for the compact event/news labels. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

/**
 * Whether an event is over, for archiving purposes. If it has an explicit
 * end_at timestamp, that decides it exactly (handles parties that run past
 * midnight). Otherwise it falls back to the end of the event's calendar
 * day — the old behaviour, kept for events nobody has set a close time on.
 *
 * Deliberately has NO import of "@/lib/db" or "neon" — this file only ever
 * does pure date math, so client components (event/track lists) can safely
 * import from here without accidentally bundling the database client (and
 * its DATABASE_URL secret) into the browser.
 */
export function eventHasEnded(dateIso: string, endAt: string | null): boolean {
  const now = new Date();
  if (endAt) return now >= new Date(endAt);
  const endOfDay = new Date(`${dateIso}T23:59:59`);
  return now > endOfDay;
}

/* ===================================================================
 * LA HORA DE UN EVENTO, Y LA MADRUGADA
 * =================================================================== */

/**
 * El offset de Bogotá, FIJO.
 *
 * Colombia no tiene horario de verano —UTC-05:00 todo el año, desde 1993— así que
 * un offset literal no solo alcanza: es MÁS predecible que consultar una base de
 * zonas, porque no puede cambiar debajo de los pies entre dos despliegues.
 *
 * Y es EXPLÍCITO a propósito, nunca la zona del servidor. Vercel corre en UTC, así
 * que `new Date("2026-11-15T23:00")` —sin offset— se interpreta como UTC y guarda
 * una fiesta de las 23:00 como si fueran las 18:00 de Bogotá. Cinco horas de
 * error, sin ningún síntoma.
 *
 * El día que HOTU salga de Colombia esto tiene que pasar a ser un dato del evento
 * —su ciudad tiene zona— y no una constante. Hasta entonces, una constante con su
 * razón escrita es mejor que una abstracción que nadie usa.
 */
export const OFFSET_BOGOTA = "-05:00";

/** Hasta qué hora, inclusive, se considera "la noche del día anterior". */
const FIN_DE_LA_MADRUGADA_MIN = 6 * 60;

/**
 * ¿Esta hora pertenece a la madrugada, o sea a la noche del día ANTERIOR?
 *
 * En la escena, una fiesta del "sábado 15" que arranca a la 1:00 arranca el
 * domingo 16. El flyer dice 15 y la gente entiende 15; el instante es del 16. Los
 * dos son ciertos y por eso event_date y starts_at son columnas distintas.
 *
 * 06:00 CUENTA COMO MADRUGADA y 06:01 ya no. El corte es arbitrario en el minuto
 * exacto —toda hora de cierre lo es— pero tiene que estar en UN lugar, y este es.
 */
export function esMadrugada(hora: string): boolean {
  const m = minutosDe(hora);
  return m !== null && m <= FIN_DE_LA_MADRUGADA_MIN;
}

/** "HH:MM" -> minutos desde medianoche, o null si no es una hora. */
function minutosDe(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** El día siguiente de un YYYY-MM-DD, sin que la zona del servidor opine. */
export function diaSiguiente(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  // Date.UTC evita que el día cambie según dónde corra esto.
  const t = new Date(Date.UTC(y, m - 1, d) + 86400000);
  return t.toISOString().slice(0, 10);
}

export type InstanteArmado = {
  /** El timestamptz listo para la base, con offset explícito. */
  iso: string;
  /** El día CALENDARIO en el que cae, que puede no ser el del evento. */
  dia: string;
  /** Si cayó en el día siguiente por la regla de la madrugada. */
  esMadrugada: boolean;
};

/**
 * Arma un instante a partir del DÍA DEL EVENTO y una HORA, aplicando la regla de
 * la madrugada y la zona de Bogotá.
 *
 * Devuelve null si la hora no se entiende, para que el llamador decida el mensaje.
 *
 * Es la ÚNICA función que convierte día + hora en un timestamp, y por eso vive en
 * date-utils y no en el write path: el formulario necesita la misma respuesta para
 * poder decir "empieza la madrugada del domingo 16" ANTES de guardar. Dos copias
 * de esta regla es cómo la pantalla y la base terminan diciendo días distintos.
 */
export function armarInstante(diaDelEvento: string, hora: string): InstanteArmado | null {
  if (minutosDe(hora) === null) return null;
  const madrugada = esMadrugada(hora);
  const dia = madrugada ? diaSiguiente(diaDelEvento) : diaDelEvento;
  const [h, m] = hora.trim().split(":");
  const hh = h.padStart(2, "0");
  return {
    iso: `${dia}T${hh}:${m}:00${OFFSET_BOGOTA}`,
    dia,
    esMadrugada: madrugada,
  };
}

/** "domingo 16 de noviembre", para que el aviso del formulario nombre el día. */
export function diaEnPalabras(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * La duración, en minutos, SOLO si existen los dos extremos.
 *
 * Devuelve null cuando falta cualquiera. No se inventa una duración asumiendo que
 * una fiesta dura seis horas ni que arranca a medianoche: media respuesta acá es
 * un número que alguien va a poner en un press kit.
 */
export function duracionEnMinutos(startsAt: string | null, endAt: string | null): number | null {
  if (!startsAt || !endAt) return null;
  const a = new Date(startsAt).getTime();
  const b = new Date(endAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 60000);
}

/** "6 h", "6 h 30", o null si no hay duración que mostrar. */
export function duracionEnPalabras(startsAt: string | null, endAt: string | null): string | null {
  const min = duracionEnMinutos(startsAt, endAt);
  if (min === null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** La hora de un instante en Bogotá, "23:00", para mostrarla y para el formulario. */
export function horaEnBogota(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Bogota",
  }).format(d);
}
