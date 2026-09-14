"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

/**
 * CONTÁCTANOS, en el perfil del venue (§5.1).
 *
 * Visible para CUALQUIERA: usuario, artista, colectivo, y también sin
 * sesión. El punto es que alguien que quiere armar una fiesta pueda
 * escribirle, y pedirle cuenta primero es justo el obstáculo que haría
 * que no escriba.
 *
 * Por ahora muestra el contacto y nada más. El flujo de reserva —fechas,
 * disponibilidad, confirmación— es de otra tanda, y §5.1 lo dice así.
 * Poner un formulario que no reserva sería prometer algo que no existe.
 *
 * El contacto está detrás de un click, no impreso en la página, para que
 * no lo levante un scraper de la primera pasada.
 */
export function VenueContactButton({ venueName }: { venueName: string }) {
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="surface-chrome sheen inline-flex items-center gap-2 px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em]"
        >
          <Mail className="h-3 w-3" /> CONTÁCTANOS
        </button>
      </div>
    );
  }

  return (
    <div className="border-chrome mt-8 p-5">
      <p className="font-mono text-[10px] tracking-[0.2em] text-primary">
        CONTACTO DE {venueName.toUpperCase()}
      </p>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Todavía no hay un contacto cargado. El dueño lo agrega desde su perfil, y la
        reserva de fechas llega en una tanda posterior.
      </p>
    </div>
  );
}
