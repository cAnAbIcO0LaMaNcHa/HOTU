import type { Metadata } from "next";
import { ColaRevision } from "@/components/cola-revision";
import { getArtistsInReview } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Artistas · Cola de aprobación",
  robots: { index: false, follow: false },
};

/**
 * /admin/artistas — la cola de aprobación (ALTA-DJ pantalla 4).
 *
 * El permiso lo pone el layout de /admin, que ya exige SUPER_ADMIN. La
 * ruta de escritura lo vuelve a comprobar por su cuenta: esconder una
 * pantalla es presentación, nunca protección.
 *
 * Lo que se aprueba es PUBLICAR, no crear. El perfil ya existe y su dueño
 * ya lo llenó, así que acá se revisa algo completo y no un formulario
 * vacío, que es de lo que se trataba la decisión.
 */
export default async function AdminArtistasPage() {
  const pendientes = await getArtistsInReview();

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">COLA DE APROBACIÓN</h1>
        <span className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          {pendientes.length} {pendientes.length === 1 ? "ESPERANDO" : "ESPERANDO"}
        </span>
      </div>
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
        Lo más viejo primero. Cada tarjeta trae lo necesario para decidir sin abrir el
        perfil; el enlace está igual por si querés mirarlo entero.
      </p>

      <ColaRevision pendientes={pendientes} />
    </section>
  );
}
