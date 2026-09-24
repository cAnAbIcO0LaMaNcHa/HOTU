import type { Metadata } from "next";
import { PanelModeracion } from "@/components/panel-moderacion";
import { EliminarCuenta } from "@/components/eliminar-cuenta";
import { getBannedAccounts, getCensored } from "@/lib/db";
import { getEliminaciones } from "@/lib/accounts-delete";

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
  const [censuradas, baneadas, eliminadas] = await Promise.all([
    getCensored(),
    getBannedAccounts(),
    getEliminaciones(),
  ]);

  return (
    <section>
      <h1 className="text-3xl font-bold">MODERACIÓN</h1>
      {/*
        ESTE TEXTO DECÍA "NADA DE LO QUE PASA ACÁ BORRA DATOS".

        Era cierto y dejó de serlo: abajo de todo ahora se puede eliminar
        una cuenta. Dejarlo como estaba habría sido peor que no tenerlo,
        porque una promesa vieja se lee como una garantía vigente, y
        alguien podría apretar confiando en que se deshace.

        Sigue siendo verdad de las tres primeras acciones, así que lo que
        cambia es el alcance de la frase, no la frase entera.
      */}
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
        Censurar, banear y traspasar no borran datos: se deshacen con un click.
        Eliminar una cuenta, abajo de todo, sí borra y no se deshace. Las cuatro
        exigen un motivo, porque el motivo es lo único que recibe la persona del
        otro lado —y en la última, lo único que queda.
      </p>

      <PanelModeracion censuradas={censuradas} baneadas={baneadas} />
      <EliminarCuenta eliminaciones={eliminadas} />
    </section>
  );
}
