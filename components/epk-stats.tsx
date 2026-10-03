import { AutoTranslate } from "./auto-translate";
import {
  calcularStats,
  horasEnPalabras,
  statsVacias,
  type ToqueParaStats,
} from "@/lib/stats";

/**
 * STATS: horas tocadas, venues y ciudades. PÚBLICO y NO EDITABLE.
 *
 * No es un client component y no tiene editor, a diferencia del resto del EPK: todo lo que
 * hay acá es DERIVADO de los toques. La regla de AGENTS.md es que los números no se pueden
 * tocar —si el DJ los pudiera editar no le sirven a ningún organizador— y la forma de
 * garantizarlo no es esconder un botón: es que no exista un camino de escritura. Acá no hay
 * ninguno.
 *
 * ============================================================
 * LO QUE NO ESTÁ, Y POR QUÉ NO ESTÁ VACÍO EN LUGAR DE AUSENTE
 * ============================================================
 *
 * AGENTS.md pide también promedio de asistentes y asistentes por fiesta. No están: salen de
 * la atribución de ventas, que está POSPUESTA, con la venta online apagada detrás de
 * VENTA_ONLINE.
 *
 * Y no aparecen como filas vacías con un guión. Una fila "ASISTENTES —" se lee como "este
 * DJ no lleva gente", que es una afirmación sobre el artista; lo cierto es que la
 * plataforma todavía no mide eso. Entre decir algo falso del artista y no decir nada, no se
 * dice nada.
 *
 * ============================================================
 * EL DENOMINADOR ES PARTE DEL NÚMERO
 * ============================================================
 *
 * Las horas van siempre con en cuántos toques se midieron. "14 h" sobre 11 toques de los
 * cuales 2 declararon duración no es el total de nada, y un parcial presentado como total
 * es cómo un press kit miente sin que nadie escriba una mentira.
 */
export function EpkStats({ gigs }: { gigs: ToqueParaStats[] }) {
  const s = calcularStats(gigs);
  if (statsVacias(s)) return null;

  const hotu = horasEnPalabras(s.minutosHotu);
  const declaradas = horasEnPalabras(s.minutosDeclarados);
  const hayHoras = hotu !== null || declaradas !== null;

  return (
    <div className="mt-14">
      <h2 className="text-2xl font-bold">STATS</h2>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs tracking-widest text-muted-foreground">
        {/* Las horas de HOTU y las declaradas van SEPARADAS: las primeras las fijó el
            organizador en el evento, las segundas las escribió el DJ. Las dos valen, no
            son la misma clase de dato, y juntarlas haría leer las auto-declaradas como
            verificadas. */}
        {hotu && (
          <div>
            <dt className="text-[10px] tracking-[0.3em] text-primary">HORAS EN HOTU</dt>
            <dd className="mt-1 text-foreground/80">{hotu}</dd>
          </div>
        )}
        {declaradas && (
          <div>
            <dt className="text-[10px] tracking-[0.3em] text-primary">HORAS DECLARADAS</dt>
            <dd className="mt-1 text-foreground/80">{declaradas}</dd>
          </div>
        )}
        {s.venues > 0 && (
          <div>
            <dt className="text-[10px] tracking-[0.3em] text-primary">VENUES</dt>
            <dd className="mt-1 text-foreground/80">{s.venues}</dd>
          </div>
        )}
        {s.ciudades > 0 && (
          <div>
            <dt className="text-[10px] tracking-[0.3em] text-primary">CIUDADES</dt>
            <dd className="mt-1 text-foreground/80">{s.ciudades}</dd>
          </div>
        )}
      </dl>

      {hayHoras && (
        <p className="mt-4 font-mono text-[10px] tracking-widest text-muted-foreground">
          <AutoTranslate
            text={
              s.conDuracion === s.toques
                ? `Medido en los ${s.toques} toques.`
                : `Medido en ${s.conDuracion} de ${s.toques} toques: los demás no tienen horario cargado.`
            }
          />
        </p>
      )}
    </div>
  );
}
