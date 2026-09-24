import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isSuperAdmin } from "@/lib/roles";
import { PanelLimpieza } from "@/components/panel-limpieza";
import { getEliminaciones, limpiezaHabilitada, listarCuentas } from "@/lib/accounts-delete";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Limpieza pre-lanzamiento",
  robots: { index: false, follow: false },
};

/**
 * /admin/limpieza — sacar las cuentas de prueba antes de abrir (§8).
 *
 * ============================================================
 * DOS notFound(), NO DOS MENSAJES DE ERROR
 * ============================================================
 *
 * Si la limpieza está apagada, o si quien entra es un MODERATOR y no un
 * SUPER_ADMIN, esta página no existe. Un "no tenés permiso" confirmaría
 * que hay una pantalla que borra cuentas y que solo falta el permiso; un
 * 404 no dice nada.
 *
 * El layout de /admin ya dejó pasar a cualquier moderador, así que el
 * segundo chequeo no es redundante: es el que separa moderar de borrar.
 * Y la ruta lo vuelve a comprobar, más el secreto, más el interruptor.
 *
 * ============================================================
 * ESTA PÁGINA TIENE FECHA DE VENCIMIENTO
 * ============================================================
 *
 * El día del lanzamiento se saca LIMPIEZA_PRELANZAMIENTO del entorno y
 * desaparece —la página y la ruta— sin desplegar nada. Es a propósito
 * que el interruptor esté afuera del código: apagar algo peligroso no
 * debería depender de acordarse de borrar un archivo.
 */
export default async function AdminLimpiezaPage() {
  if (!limpiezaHabilitada()) notFound();

  const session = await auth();
  const email = session?.user?.email;
  if (!email || !(await isSuperAdmin(email))) notFound();

  const [cuentas, hechas] = await Promise.all([listarCuentas(), getEliminaciones()]);

  return (
    <section>
      <h1 className="text-3xl font-bold">LIMPIEZA PRE-LANZAMIENTO</h1>
      <p className="mt-3 max-w-3xl font-mono text-xs leading-relaxed text-muted-foreground">
        La única pantalla de HOTU que borra de verdad, y la única que puede tocar
        pedidos y boletas. No afloja ninguna guarda: el RESTRICT de la base sigue
        intacto, y lo que hace es sacar de adelante lo que protege, en orden y
        contándolo.
      </p>

      <PanelLimpieza cuentas={cuentas} hechas={hechas} />
    </section>
  );
}
