import type { Metadata } from "next";
import { ColaReclamos } from "@/components/cola-reclamos";
import { getReclamosPendientes } from "@/lib/claims-write";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Reclamos de perfil",
  robots: { index: false, follow: false },
};

/**
 * /admin/reclamos — la cuarta cola (§8 pieza 2).
 *
 * Las otras tres aprueban CONTENIDO. Esta entrega el CONTROL de un perfil,
 * y esa diferencia es la que el texto de arriba tiene que dejar clara: un
 * reclamo aprobado le da a alguien la llave para editar todo lo que ese
 * perfil publique de acá en adelante.
 */
export default async function AdminReclamosPage() {
  const reclamos = await getReclamosPendientes();

  return (
    <section>
      <h1 className="text-3xl font-bold">RECLAMOS DE PERFIL</h1>
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
        Alguien dice que un perfil es suyo. Las otras colas aprueban contenido; esta
        entrega el <strong>control</strong> de un perfil, así que lo que se aprueba es la
        llave para editar todo lo que publique de acá en adelante.
      </p>
      <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
        <strong>No hay verificación automática, y no puede haberla</strong>: el correo de
        estos perfiles no existe, y el patrón del email se deduce de la URL, así que
        conocerlo no prueba nada. Lo único que decide es tu criterio sobre lo que
        escribieron.
      </p>

      <ColaReclamos reclamos={reclamos} />
    </section>
  );
}
