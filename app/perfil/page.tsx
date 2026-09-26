import type { Metadata } from "next";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { auth } from "@/auth";
import { PanelSwitcher, panelValido } from "@/components/panel-switcher";
import { PanelMiPerfil } from "@/components/panel-mi-perfil";
import { PanelArtista } from "@/components/panel-artista";
import { PanelColectivo } from "@/components/panel-colectivo";
import { MisReclamos } from "@/components/mis-reclamos";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mi perfil",
  description: "Tu cuenta, tu press kit, tus colectivos y tus venues en HOTU.",
};

/**
 * /perfil — cuatro paneles: MI PERFIL · ARTISTA · COLECTIVO · VENUE.
 *
 * ============================================================
 * ANTES ERA UNA COLUMNA DE 359 LÍNEAS
 * ============================================================
 *
 * Todo colgaba de acá mezclado: el press kit arriba de los pedidos,
 * arriba de los paneles de colectivo, arriba de los tiquetes, arriba de
 * las invitaciones. Y las quince consultas corrían SIEMPRE, aunque solo
 * fueras a mirar un tiquete.
 *
 * Ahora el panel vive en la URL —/perfil?panel=colectivo— y el servidor
 * sabe cuál pedís antes de consultar, así que cada panel pide lo suyo y
 * nada más. Además se puede compartir y sobrevive a recargar, que un tab
 * con useState no hace.
 *
 * ============================================================
 * EL PANEL QUE NO TENÉS NO DESAPARECE
 * ============================================================
 *
 * Los cuatro se muestran siempre. Es lo contrario de la regla de las
 * secciones vacías, y a propósito: una sección vacía no le sirve a nadie,
 * pero un panel que no tenés es justamente donde va la invitación a
 * tenerlo. Si desapareciera, alguien que entra sin perfil de artista no
 * tendría cómo enterarse de que puede tener uno.
 *
 * VENUE usa el mismo componente que COLECTIVO con otro entity_kind:
 * comparten tabla y el panel es idéntico, lo único que cambia son las
 * palabras y a qué sección linkea.
 */
export default async function PerfilPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
        <LogIn className="h-8 w-8 text-primary" />
        <h1 className="mt-4 text-3xl font-bold">Inicia sesion</h1>
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          Entra con tu cuenta de Google para ver tus pedidos y tiquetes.
        </p>
        <Link
          href="/auth/signin?callbackUrl=/perfil"
          className="surface-chrome sheen mt-6 inline-flex px-6 py-3 font-mono text-xs tracking-widest"
        >
          CONTINUAR CON GOOGLE
        </Link>
      </section>
    );
  }

  const email = session.user.email ?? "";
  // Cualquier cosa rara en ?panel= cae en MI PERFIL, que es el único que
  // está garantizado que tiene contenido para cualquier cuenta.
  const { panel } = await searchParams;
  const activo = panelValido(panel);

  /**
   * Asymmetric padding on purpose. The footer already opens with 64px of
   * its own, so a matching 96px at the bottom of this section stacked into
   * a 160px void between the last ticket and the first line of the footer
   * — the "hueco grande" of HOTFIX punto 6. The top keeps its full spacing,
   * where there is nothing above to share the gap with.
   */
  return (
    <section className="mx-auto max-w-5xl px-4 pb-10 pt-16 md:pb-12 md:pt-24">
      <PanelSwitcher activo={activo} />

      {activo === "mi-perfil" && (
        <>
          <PanelMiPerfil
            email={email}
            nombre={session.user.name ?? "Perfil"}
            imagen={session.user.image}
          />
          {/* Los reclamos van en MI PERFIL y no en ARTISTA, porque reclamar
              es algo que hace una CUENTA antes de tener perfil de artista:
              ponerlos ahí los esconde de quien todavía no tiene ninguno,
              que es exactamente quien está reclamando. Se rinde a null si
              no hay ninguno. */}
          <MisReclamos email={email} />
        </>
      )}
      {activo === "artista" && <PanelArtista email={email} />}
      {activo === "colectivo" && <PanelColectivo email={email} />}
      {activo === "venue" && <PanelColectivo email={email} kind="venue" />}
    </section>
  );
}
