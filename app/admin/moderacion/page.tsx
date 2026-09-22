import type { Metadata } from "next";
import { PanelModeracion } from "@/components/panel-moderacion";
import { getBannedAccounts, getCensored } from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Moderación",
  robots: { index: false, follow: false },
};

/**
 * /admin/moderacion — censurar contenido y cerrar cuentas (tanda 5 §4).
 *
 * Las dos acciones que no son una cola. Juntas en una pantalla porque
 * son la misma decisión mirada desde dos alturas: bajar UNA pieza, o
 * cerrar la cuenta de quien la puso.
 *
 * Las dos listan lo que está hecho. Una decisión de moderación que no se
 * puede revisar después es una decisión que nadie audita.
 */
export default async function AdminModeracionPage() {
  const [censuradas, baneadas] = await Promise.all([getCensored(), getBannedAccounts()]);

  return (
    <section>
      <h1 className="text-3xl font-bold">MODERACIÓN</h1>
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
        Nada de lo que pasa acá borra datos. Censurar esconde una pieza y banear
        cierra una puerta; las dos se deshacen con un click y las dos exigen un
        motivo, porque el motivo es lo único que recibe la persona del otro lado.
      </p>

      <PanelModeracion censuradas={censuradas} baneadas={baneadas} />
    </section>
  );
}
