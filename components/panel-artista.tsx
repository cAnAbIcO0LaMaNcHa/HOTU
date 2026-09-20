import Link from "next/link";
import { ChevronRight, Disc3 } from "lucide-react";
import { BotonPublicar } from "@/components/boton-publicar";
import { MembershipInbox } from "@/components/membership-inbox";
import { ColabInbox } from "@/components/colab-inbox";
import { CrearArtista } from "@/components/crear-artista";
import { PanelVacio } from "@/components/panel-switcher";
import {
  getArtistBySlug,
  getGenreBranches,
  getGenreTags,
  getInvitacionesColab,
  getMyArtistSlug,
  getMyCurrentCasa,
  getMyMemberships,
  getPendingForArtist,
} from "@/lib/db";

/**
 * Panel ARTISTA: el press kit propio y todo lo que le llega al DJ.
 *
 * Press kit, solicitudes de membresía, invitaciones de colaboración. Lo
 * que antes estaba mezclado con los pedidos y los tiquetes en una sola
 * columna larga.
 *
 * SIN PERFIL DE DJ EL PANEL NO DESAPARECE: ahí va la invitación a
 * crearlo. Es el único lugar donde alguien que no sabe que puede tener un
 * press kit se puede enterar.
 *
 * Cada panel consulta lo suyo y nada más. La página vieja pedía las
 * quince consultas siempre, aunque solo fueras a mirar tus tiquetes.
 */
export async function PanelArtista({ email }: { email: string }) {
  const myArtistSlug = await getMyArtistSlug(email);

  /**
   * SOLO LAS DIRIGIDAS AL ARTISTA. Las dirigidas a un colectivo viven en
   * el panel COLECTIVO: la distinción es a QUIÉN ESTÁ DIRIGIDA, no quién
   * la recibe. Las dos le llegan a la misma cuenta por owner_email, pero
   * el dueño de un colectivo va a buscar la suya donde administra.
   *
   * Sin perfil de DJ no puede haber ninguna dirigida al artista, así que
   * acá no se pregunta.
   */
  if (!myArtistSlug) {
    // El vocabulario de géneros solo se pide acá, que es donde hay un
    // selector que lo use. Un DJ que ya existe no abre este formulario.
    const [branches, tags] = await Promise.all([getGenreBranches(), getGenreTags()]);
    return (
      <>
        <PanelVacio
          titulo="TODAVÍA NO SOS DJ ACÁ"
          explicacion="Un perfil de DJ es tu press kit público: biografía, sets, tracks, los eventos donde tocaste y tus números reales de convocatoria. Es lo que un organizador mira antes de contratarte, y es el primer escalón — sin él no podés fundar un colectivo ni registrar un venue."
        />
        <CrearArtista branches={branches} tags={tags} />
      </>
    );
  }

  // Con el email propio: un perfil recién creado está en borrador, y sin
  // esto el dueño no vería su propio press kit en su propio perfil.
  const [myArtist, pending, currentCasa, memberships, invitaciones] = await Promise.all([
    getArtistBySlug(myArtistSlug, email),
    getPendingForArtist(email),
    getMyCurrentCasa(email),
    getMyMemberships(email),
    getInvitacionesColab(email, "artist"),
  ]);

  return (
    <>
      {/*
        EL "+" DEL PANEL ARTISTA LLEVA AL PRESS KIT, no abre un
        formulario propio. El de subir un set ya existe ahí (EpkNewRow) y
        es más completo que cualquier copia: invita colaboradores, y esa
        invitación es la que decide dónde queda fija la pieza para
        siempre. Dos formularios para lo mismo son dos reglas para lo
        mismo, y una de las dos se queda vieja.
      */}
      {myArtist && (
        <BotonPublicar
          acciones={[
            {
              tipo: "enlace",
              id: "set",
              label: "SUBIR UN SET",
              que: "Una grabación tuya. Podés invitar a quien tocó con vos.",
              href: `/artistas/${myArtist.slug}#sets`,
            },
            {
              tipo: "enlace",
              id: "track",
              label: "SUBIR UN TRACK",
              que: "Una producción propia, con portada y sello.",
              href: `/artistas/${myArtist.slug}#tracks`,
            },
          ]}
        />
      )}

      {myArtist && (
        <div className="border-chrome mt-10 p-6">
          <h2 className="inline-flex items-center gap-2 text-xl font-bold">
            <Disc3 className="h-4 w-4 text-primary" /> MI PRESS KIT
          </h2>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            Tu perfil público de DJ. Se edita ahí mismo: entrás y cambiás lo que veas, sin
            formularios aparte. Los sets y tracks se suben desde ahí.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/artistas/${myArtist.slug}`}
              className="surface-chrome sheen inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em]"
            >
              VER Y EDITAR <ChevronRight className="h-3 w-3" />
            </Link>
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              {myArtist.name}
              {myArtist.djCode ? ` · CÓDIGO ${myArtist.djCode}` : ""}
            </span>
          </div>
        </div>
      )}

      {/* Invitaciones a colaborar (§6.1) y conversaciones de membresía.
          Las dos esperan una respuesta de quien mira, así que van
          arriba de todo lo demás del panel. */}
      <ColabInbox invitaciones={invitaciones} />

      <MembershipInbox pending={pending} memberships={memberships} currentCasa={currentCasa} />
    </>
  );
}
