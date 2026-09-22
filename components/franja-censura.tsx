import { ShieldAlert } from "lucide-react";

/**
 * LA NOTIFICACIÓN DE QUE ALGO TUYO FUE BAJADO (tanda 5 §4).
 *
 * ============================================================
 * NO HAY UN SISTEMA DE AVISOS NUEVO, Y NO HACE FALTA
 * ============================================================
 *
 * El aviso vive PEGADO A LA PIEZA, que es donde el autor va a ir de
 * todos modos, y dice el motivo completo. Es el mismo criterio que la
 * franja de revisión del press kit y que MIS NOTICIAS: un aviso que te
 * saca de contexto para decirte que algo pasó te obliga a volver a
 * buscar dónde pasó.
 *
 * ============================================================
 * DICE QUE NO SE PUEDE REPUBLICAR, Y POR QUÉ
 * ============================================================
 *
 * Es la diferencia entera con despublicar. Si esto fuera un
 * status='draft', el autor lo leería como un borrador suyo y lo volvería
 * a publicar sin enterarse nunca de que alguien lo decidió. Así que la
 * franja no dice solo "está bajado": dice quién lo bajó, por qué, y que
 * el botón de publicar no lo va a devolver.
 *
 * Server component: no tiene estado ni acciones. El autor no puede hacer
 * nada acá, y eso es exactamente lo que tiene que quedar claro.
 */
export function FranjaCensura({
  motivo,
  censuradaEn,
  que = "Esto",
}: {
  motivo: string | null;
  censuradaEn: string | null;
  /** Cómo nombrar la pieza: "Tu perfil", "Esta noticia", "Este set". */
  que?: string;
}) {
  if (!censuradaEn) return null;

  return (
    <div className="mb-8 border-2 border-red-400/60 p-5">
      <p className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-red-400">
        <ShieldAlert className="h-3 w-3" /> BAJADO POR EL EQUIPO DE HOTU
      </p>

      <p className="mt-3 font-mono text-[11px] leading-relaxed">
        {que} no se ve en el sitio. Lo bajó un moderador
        {censuradaEn ? ` el ${new Date(censuradaEn).toLocaleDateString("es-CO")}` : ""}, y
        solo un moderador lo puede devolver: <strong>volver a publicarlo no lo va a
        traer de vuelta.</strong>
      </p>

      {motivo && (
        <blockquote className="mt-4 border-l-2 border-red-400/60 pl-4 font-mono text-[12px] leading-relaxed">
          {motivo}
        </blockquote>
      )}

      <p className="mt-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Nada se borró: si esto se resuelve, vuelve entero y como estaba. Si creés que
        es un error, respondé por el canal de contacto — desde acá no hay nada que
        apretar, a propósito.
      </p>
    </div>
  );
}
