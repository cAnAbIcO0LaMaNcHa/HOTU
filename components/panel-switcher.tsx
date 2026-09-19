import Link from "next/link";
import { Building2, Disc3, MapPin, User } from "lucide-react";

/**
 * Los cuatro paneles de /perfil: MI PERFIL · ARTISTA · COLECTIVO · VENUE.
 *
 * ============================================================
 * EL PANEL QUE NO TENÉS NO DESAPARECE
 * ============================================================
 *
 * Los cuatro se muestran siempre, tengas o no cada cosa. Es lo contrario
 * de la regla de las secciones vacías, y a propósito: una sección vacía
 * no le sirve a nadie, pero un panel que no tenés es justamente donde va
 * la invitación a tenerlo. "Creá tu perfil de DJ" solo puede vivir en el
 * panel ARTISTA de alguien que no es DJ.
 *
 * Si el panel desapareciera, alguien que entra sin perfil de artista no
 * tendría forma de descubrir que puede tener uno — y descubrirlo es la
 * mitad de lo que esta tanda viene a arreglar.
 *
 * ============================================================
 * SON LINKS, NO ESTADO DE CLIENTE
 * ============================================================
 *
 * Cada pestaña es un <Link> a ?panel=..., así que el panel elegido vive
 * en la URL. Tres consecuencias que valen más que la instantaneidad de
 * un tab con useState:
 *
 * 1. Se puede compartir y volver: /perfil?panel=colectivo es una
 *    dirección, no un estado que se pierde al recargar.
 * 2. El servidor sabe qué panel se pide ANTES de consultar, así que cada
 *    panel pide solo lo suyo. La página vieja hacía sus quince consultas
 *    siempre, aunque solo fueras a mirar tus tiquetes.
 * 3. No hace falta mandar los cuatro paneles al navegador para mostrar
 *    uno.
 *
 * Server component: son links, no hay estado.
 */

export type PanelId = "mi-perfil" | "artista" | "colectivo" | "venue";

export const PANELES: Array<{ id: PanelId; label: string }> = [
  { id: "mi-perfil", label: "MI PERFIL" },
  { id: "artista", label: "ARTISTA" },
  { id: "colectivo", label: "COLECTIVO" },
  { id: "venue", label: "VENUE" },
];

/** Lo que llega por ?panel=, saneado. Cualquier cosa rara cae en MI PERFIL. */
export function panelValido(valor: string | undefined): PanelId {
  const encontrado = PANELES.find((p) => p.id === valor);
  return encontrado ? encontrado.id : "mi-perfil";
}

const ICONOS: Record<PanelId, typeof User> = {
  "mi-perfil": User,
  artista: Disc3,
  colectivo: Building2,
  venue: MapPin,
};

export function PanelSwitcher({ activo }: { activo: PanelId }) {
  return (
    <nav
      aria-label="Paneles del perfil"
      className="mt-8 flex flex-wrap gap-2 border-b border-border pb-4"
    >
      {PANELES.map((p) => {
        const Icono = ICONOS[p.id];
        const esActivo = p.id === activo;
        return (
          <Link
            key={p.id}
            href={`/perfil?panel=${p.id}`}
            aria-current={esActivo ? "page" : undefined}
            className={`inline-flex items-center gap-2 border px-3 py-2 font-mono text-[10px] tracking-[0.2em] transition-colors ${
              esActivo
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            <Icono className="h-3 w-3" />
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * La invitación que ve quien todavía no tiene ese panel.
 *
 * Dice qué es y para qué sirve antes de pedir el click. "Creá tu
 * colectivo" a secas no le dice nada a alguien que no sabe que puede
 * tener uno, y esta pantalla existe justamente para los que no lo saben.
 */
export function PanelVacio({
  titulo,
  explicacion,
  children,
}: {
  titulo: string;
  explicacion: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-10 border border-dashed border-border p-8 text-center">
      <h2 className="text-xl font-bold">{titulo}</h2>
      <p className="mx-auto mt-3 max-w-lg font-mono text-[11px] leading-relaxed text-muted-foreground">
        {explicacion}
      </p>
      {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}
