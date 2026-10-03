/**
 * LAS STATS DEL EPK. Cálculo puro, sin imports de base.
 *
 * Vive fuera de lib/db.ts porque la sección es un client component, y lib/db.ts llama
 * neon(process.env.DATABASE_URL!) a nivel de módulo: importar un VALOR de ahí mete el
 * cliente de la base en el bundle del navegador. Mismo motivo que lib/socials.ts,
 * lib/rider.ts y lib/date-utils.ts.
 *
 * ============================================================
 * QUÉ SE PUEDE CALCULAR HOY, Y QUÉ NO
 * ============================================================
 *
 * AGENTS.md pide tres cosas de STATS: promedio de asistentes, tabla de asistentes por
 * fiesta, y horas tocadas. De esas:
 *
 *   HORAS TOCADAS — SÍ. Sale de duration_minutes de los toques declarados y, desde que
 *   events tiene starts_at y end_at, también de los toques de lineup. Solo donde el dato
 *   existe; nunca estimado.
 *
 *   ASISTENTES, Y SU PROMEDIO — NO, y no es una limitación técnica: la atribución de
 *   ventas está POSPUESTA por decisión de producto y la venta online está apagada detrás
 *   de VENTA_ONLINE. ticket_attributions tiene filas en dev, pero son del seed. Calcular
 *   un promedio de asistentes con eso sería mostrar un número de prueba en un press kit.
 *   No se calcula, y la sección no lo menciona: una fila "asistentes: —" invita a creer
 *   que el dato existe y está en cero.
 *
 * ============================================================
 * EL DENOMINADOR VA SIEMPRE A LA VISTA
 * ============================================================
 *
 * Es la decisión de diseño que importa. "14 h tocadas" sobre 11 toques de los cuales 2
 * declararon duración NO es 14 h: es 14 h medidas en 2 toques. Un parcial presentado como
 * total es la forma más fácil de que un press kit mienta sin que nadie escriba una
 * mentira, y acá los números son todo el valor del press kit.
 *
 * Así que el cálculo devuelve SIEMPRE con qué se hizo —`conDuracion` sobre `toques`— y la
 * UI está obligada a mostrarlo porque el dato viene en el mismo objeto.
 *
 * ============================================================
 * LAS HORAS SE PARTEN POR ORIGEN, Y ESO NO ES DECORACIÓN
 * ============================================================
 *
 * Un toque de HOTU sale del lineup de un evento publicado en la plataforma: su duración la
 * fijó el organizador. Un toque declarado lo carga el DJ a mano, con la duración que
 * escribe él.
 *
 * Los dos son legítimos y los dos van, pero NO son la misma clase de dato, y el press kit
 * se apoya justamente en que un organizador pueda confiar en los números. Juntarlos en un
 * solo total haría que las horas auto-declaradas se leyeran como verificadas. Separadas, el
 * organizador decide cuánto peso les da — que es lo que ya hace la sección EVENTS marcando
 * los toques declarados como declarados.
 */

export type ArtistStats = {
  /** Toques en total, de las dos fuentes. */
  toques: number;
  /** Cuántos de esos declararon duración. El denominador de las horas. */
  conDuracion: number;
  /** Minutos de toques que salen del lineup de un evento de HOTU. */
  minutosHotu: number;
  /** Minutos de toques que el DJ declaró a mano. */
  minutosDeclarados: number;
  /** Venues distintos donde tocó. */
  venues: number;
  /** Ciudades distintas donde tocó. */
  ciudades: number;
};

/** Lo mínimo que stats necesita de un toque. Un subconjunto de ArtistGig a propósito:
 *  así el cálculo se puede probar sin armar la fila entera. */
export type ToqueParaStats = {
  venue: string | null;
  city: string | null;
  durationMinutes: number | null;
  source: "hotu" | "declarado";
};

export function calcularStats(toques: ToqueParaStats[]): ArtistStats {
  let minutosHotu = 0;
  let minutosDeclarados = 0;
  let conDuracion = 0;
  const venues = new Set<string>();
  const ciudades = new Set<string>();

  for (const t of toques) {
    /**
     * Una duración de 0 o negativa no cuenta como "declarada". No debería existir —el
     * CHECK de events exige end_at > starts_at— pero duration_minutes de artist_gigs lo
     * carga el DJ a mano y no tiene esa guarda, así que acá se filtra en vez de confiar.
     */
    if (typeof t.durationMinutes === "number" && t.durationMinutes > 0) {
      conDuracion += 1;
      if (t.source === "hotu") minutosHotu += t.durationMinutes;
      else minutosDeclarados += t.durationMinutes;
    }
    /** Se normaliza para no contar "Bodega 38" y "bodega 38 " como dos lugares. */
    const v = (t.venue ?? "").trim().toLowerCase();
    const c = (t.city ?? "").trim().toLowerCase();
    if (v) venues.add(v);
    if (c) ciudades.add(c);
  }

  return {
    toques: toques.length,
    conDuracion,
    minutosHotu,
    minutosDeclarados,
    venues: venues.size,
    ciudades: ciudades.size,
  };
}

/**
 * "7 h", "7 h 30", "45 min". Nunca "0 h": con cero minutos devuelve null y el llamador no
 * muestra la fila, porque un cero acá no significa "tocó cero horas" sino "no sabemos
 * cuánto tocó", y las dos cosas se leen igual en la pantalla.
 */
export function horasEnPalabras(minutos: number): string | null {
  if (!Number.isFinite(minutos) || minutos <= 0) return null;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** True cuando no hay NADA que mostrar y la sección no se renderiza. */
export function statsVacias(s: ArtistStats): boolean {
  return (
    s.toques === 0 ||
    (s.minutosHotu === 0 && s.minutosDeclarados === 0 && s.venues === 0 && s.ciudades === 0)
  );
}
