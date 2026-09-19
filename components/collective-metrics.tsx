import type { MetricasColectivo } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";

/**
 * MÉTRICAS del colectivo o del venue (§4.4).
 *
 * SOLO DE EVENTOS QUE ORGANIZÓ. Nunca la suma de los toques de sus
 * miembros — un colectivo de diez DJs acumularía miles de horas que no
 * son suyas. El cálculo entero sale de events.organizer_slug.
 *
 * SIN EVENTOS ORGANIZADOS NO SE RENDERIZA NADA. Es la regla de siempre, y
 * es el estado de hoy: ningún evento tiene organizador asignado, porque
 * eso no salía del texto del flyer y se carga a mano. Un bloque de
 * métricas en cero no informa que el colectivo no organizó nada, informa
 * que el dato no está — y son dos cosas distintas.
 *
 * NO HAY MÉTRICA DE HORAS, aunque §4.3 la pedía. No falta el dato,
 * falta la columna: events.event_date es un DATE y un evento no guarda a
 * qué hora empezó, así que con solo end_at la resta mide desde la
 * medianoche. Un número equivocado en el press kit que un colectivo le
 * muestra a un organizador es peor que una métrica de menos.
 *
 * Server component: solo lee.
 */
export function CollectiveMetrics({
  metricas,
  esVenue = false,
}: {
  metricas: MetricasColectivo;
  esVenue?: boolean;
}) {
  if (metricas.eventos === 0) return null;

  const celdas: Array<{ valor: string; etiqueta: string }> = [
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
          </div>
        ))}
      </div>
    </div>
  );
}
