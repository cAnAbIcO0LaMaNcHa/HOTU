import type { MetricasColectivo } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { horasEnPalabras } from "@/lib/stats";

/**
 * MÉTRICAS del colectivo o del venue (§4.4 y §13).
 *
 * LOS EVENTOS, VENUES, CIUDADES Y HORAS SALEN SOLO DE LO QUE ORGANIZÓ. Nunca la suma de los
 * toques de sus miembros — un colectivo de diez DJs acumularía miles de horas que no son
 * suyas. Todo eso sale de events.organizer_slug.
 *
 * LOS DJs Y LAS MEMBRESÍAS son otra cosa y por eso miran otras tablas: no son actividad, son
 * COMPOSICIÓN. Cuántos DJs pasaron por sus fiestas sigue saliendo del lineup de SUS eventos;
 * con cuántos cuenta hoy sale de artist_collectives.
 *
 * SIN EVENTOS ORGANIZADOS NO SE RENDERIZA NADA. Es la regla de siempre, y es el estado de
 * hoy: ningún evento tiene organizador asignado, porque eso no salía del texto del flyer y se
 * carga a mano. Un bloque de métricas en cero no informa que el colectivo no organizó nada,
 * informa que el dato no está — y son dos cosas distintas.
 *
 * ============================================================
 * LAS HORAS VOLVIERON, Y EL COMENTARIO QUE DECÍA QUE NO SE PODÍAN YA ERA FALSO
 * ============================================================
 *
 * Decía: "NO HAY MÉTRICA DE HORAS, aunque §4.3 la pedía. No falta el dato, falta la columna:
 * events.event_date es un DATE y un evento no guarda a qué hora empezó, así que con solo
 * end_at la resta mide desde la medianoche."
 *
 * Era cierto cuando se escribió y dejó de serlo con la migración de la hora de inicio:
 * events.starts_at existe. El comentario sobrevivió a su motivo, que es la forma más común de
 * que un archivo mienta — no dice algo falso de entrada, se queda quieto mientras el mundo se
 * mueve.
 *
 * EL DENOMINADOR VA PEGADO AL NÚMERO. Las horas se suman solo de los eventos que tienen los
 * dos extremos, así que "14 h" sobre 20 eventos de los cuales 3 tienen horario no es el total
 * de nada. La celda dice en cuántos se midió. Misma regla que STATS en el EPK: un parcial
 * presentado como total es cómo un press kit miente sin que nadie escriba una mentira.
 *
 * SIN ASISTENTES, y no como celda vacía: sale de la atribución, que está pospuesta.
 * "ASISTENTES —" se lee como "este colectivo no lleva gente", que es una afirmación sobre
 * ellos, cuando lo cierto es que la plataforma no lo mide todavía.
 *
 * Server component: solo lee, y no hay nada que editar — son números derivados, y la regla
 * del press kit es que quien se beneficia de ellos no los pueda tocar.
 */
export function CollectiveMetrics({
  metricas,
  esVenue = false,
}: {
  metricas: MetricasColectivo;
  esVenue?: boolean;
}) {
  if (metricas.eventos === 0) return null;

  const celdas: Array<{ valor: string; etiqueta: string; nota?: string }> = [
    {
      valor: String(metricas.eventos),
      etiqueta: metricas.eventos === 1 ? "EVENTO" : "EVENTOS",
    },
  ];

  // Un venue no cuenta "venues": es uno. Contar el lugar donde está
  // parado sería una métrica que siempre vale 1.
  if (!esVenue) {
    celdas.push({
      valor: String(metricas.venues),
      etiqueta: metricas.venues === 1 ? "VENUE" : "VENUES",
    });
    celdas.push({
      valor: String(metricas.ciudades),
      etiqueta: metricas.ciudades === 1 ? "CIUDAD" : "CIUDADES",
    });
  }

  /**
   * Las horas solo si hay alguna. horasEnPalabras devuelve null con cero minutos, y eso es
   * deliberado: una celda "0 h" se lee como "no tocaron", cuando lo que pasa es que nadie
   * cargó horarios. Son dos cosas distintas y solo una es cierta.
   */
  const horas = horasEnPalabras(metricas.minutos);
  if (horas) {
    celdas.push({
      valor: horas,
      etiqueta: "HORAS",
      nota:
        metricas.eventosConHorario === metricas.eventos
          ? `en los ${metricas.eventos}`
          : `en ${metricas.eventosConHorario} de ${metricas.eventos}`,
    });
  }

  if (metricas.djs > 0) {
    celdas.push({
      valor: String(metricas.djs),
      etiqueta: metricas.djs === 1 ? "DJ QUE TOCÓ" : "DJs QUE TOCARON",
    });
  }

  /**
   * Un venue no tiene residentes — la residencia vale solo en un colectivo, nunca en un
   * venue, y eso lo valida el write path. Mostrar "0 RESIDENTES" en un venue informaría de
   * un cupo vacío cuando el cupo no existe.
   */
  if (!esVenue && metricas.residentes > 0) {
    celdas.push({
      valor: String(metricas.residentes),
      etiqueta: metricas.residentes === 1 ? "RESIDENTE" : "RESIDENTES",
    });
  }
  if (metricas.miembros > 0) {
    celdas.push({
      valor: String(metricas.miembros),
      etiqueta: metricas.miembros === 1 ? "MIEMBRO" : "MIEMBROS",
    });
  }

  return (
    <div className="mt-16">
      <h2 className="text-xl font-bold">MÉTRICAS</h2>
      <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        <AutoTranslate
          text={
            esVenue
              ? "Solo de los eventos que organizó este venue."
              : "Solo de los eventos que organizó el colectivo, no de los toques de sus miembros."
          }
        />
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {celdas.map((c) => (
          <div key={c.etiqueta} className="border-chrome sheen p-4">
            <div className="text-3xl font-bold leading-none">{c.valor}</div>
            <div className="mt-2 font-mono text-[9px] tracking-[0.3em] text-primary">
              {c.etiqueta}
            </div>
            {/* El denominador va DENTRO de la celda, no en una nota al pie: pegado al
                número nadie lo puede leer sin verlo. */}
            {c.nota && (
              <div className="mt-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                <AutoTranslate text={c.nota} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
