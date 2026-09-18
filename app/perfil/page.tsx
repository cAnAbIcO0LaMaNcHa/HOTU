import type { Metadata } from "next";
import Link from "next/link";
import { Package, Ticket as TicketIcon, LogIn, MapPin, ChevronRight, Disc3 } from "lucide-react";
import { auth } from "@/auth";
import { getMyOrders, getMyProfile } from "@/lib/orders";
import { getMyTicketInstances } from "@/lib/tickets";
import { formatShortDate } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { ProfileHeader } from "@/components/profile-header";
import { MembershipInbox } from "@/components/membership-inbox";
import { getArtistBySlug, getGenreBranches, getGenreTags, getInvitacionesColab, getLikedArtists, getLikedCollectives, getMyArtistSlug, getPendingForArtist, getMyCurrentCasa, getMyMemberships, getCollectivesOwnedBy, getPendingForCollective, getCollectiveMembers, getRecentDepartures } from "@/lib/db";
import { CollectiveInbox } from "@/components/collective-inbox";
import { ColabInbox } from "@/components/colab-inbox";
import { LikedArtists } from "@/components/liked-artists";
import { CreateCollectiveButton } from "@/components/create-collective-button";
import { CrearArtista } from "@/components/crear-artista";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mi perfil",
  description: "Tus pedidos y tiquetes en HOTU.",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDIENTE DE PAGO",
  paid: "PAGADO",
  cancelled: "CANCELADO",
};

export default async function PerfilPage() {
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

  /**
   * What this account IS decides what this page renders (§5.2).
   *
   * The roles are not exclusive and are not a column: an account is a DJ
   * because it owns an artist, and a collective because it owns a
   * collective, and plenty of people are both. Reading it off ownership
   * means there is no flag that can disagree with reality.
   *
   * Everything a role does not cover is simply not rendered — not hidden
   * with CSS, not greyed out. A plain user's page has no press kit link
   * and no membership inbox because that markup never exists for them.
   */
  // Colectivos y venues por separado: comparten tabla, pero son dos
  // secciones distintas y dos paneles distintos. Uno de cada por cuenta.
  const [myArtistSlug, owned, ownedVenues] = await Promise.all([
    getMyArtistSlug(email),
    getCollectivesOwnedBy(email),
    getCollectivesOwnedBy(email, "venue"),
  ]);
  const isDJ = myArtistSlug !== null;

  // Everybody gets these three: orders, tickets, the artists they follow.
  const [orders, tickets, profile, likedArtists, likedColectivos, likedVenues, invitaciones] = await Promise.all([
    getMyOrders(),
    getMyTicketInstances(),
    getMyProfile(),
    getLikedArtists(email),
    getLikedCollectives(email, "collective"),
    getLikedCollectives(email, "venue"),
    getInvitacionesColab(email),
  ]);

  // DJ-only. A plain user has no memberships to have a conversation about,
  // so these queries do not even run for them.
  const [pending, currentCasa, memberships] = isDJ
    ? await Promise.all([
        getPendingForArtist(email),
        getMyCurrentCasa(email),
        getMyMemberships(email),
      ])
    : [[], null, []];

  // Con el email propio: un perfil recién creado está en borrador, y sin
  // esto el dueño no vería su propio press kit en su propio perfil.
  const myArtist = myArtistSlug ? await getArtistBySlug(myArtistSlug, email) : undefined;

  /**
   * El vocabulario solo se pide cuando esta página va a ofrecer un
   * selector: crear el perfil de DJ, o crear un colectivo. Son dos casos
   * distintos y hay que mirar los dos —el de colectivo aparece
   * justamente cuando SÍ sos DJ—, así que condicionarlo solo a !isDJ
   * dejaba el selector del colectivo sin opciones.
   *
   * Crear un venue no lo necesita: un venue no declara género.
   */
  const necesitaVocabulario = !isDJ || owned.length === 0;
  const [genreBranches, genreTags] = necesitaVocabulario
    ? await Promise.all([getGenreBranches(), getGenreTags()])
    : [[], []];

  // Los dos rosters van por separado: getCollectiveMembers filtra por
  // tipo, así que pedirlo una sola vez dejaría sin miembros a uno de los
  // dos paneles.
  const membersByCollective = owned.length > 0 ? await getCollectiveMembers() : new Map();
  const membersByVenue =
    ownedVenues.length > 0 ? await getCollectiveMembers("venue") : new Map();

  const ownedVenueInboxes = await Promise.all(
    ownedVenues.map(async (v) => ({
      collective: v,
      pending: await getPendingForCollective(v.slug),
      members: membersByVenue.get(v.slug) ?? [],
      departures: await getRecentDepartures(v.slug, 5),
    }))
  );

  const ownedInboxes = await Promise.all(
    owned.map(async (c) => ({
      collective: c,
      pending: await getPendingForCollective(c.slug),
      members: membersByCollective.get(c.slug) ?? [],
      departures: await getRecentDepartures(c.slug, 5),
    }))
  );
  const ticketsPreview = tickets.slice(0, 3);

  /**
   * Asymmetric padding on purpose. The footer already opens with 64px of
   * its own, so a matching 96px at the bottom of this section stacked into
   * a 160px void between the last ticket and the first line of the footer
   * — the "hueco grande" of HOTFIX punto 6. The top keeps its full spacing,
   * where there is nothing above to share the gap with.
   */
  return (
    <section className="mx-auto max-w-5xl px-4 pb-10 pt-16 md:pb-12 md:pt-24">
      <ProfileHeader
        name={session.user.name ?? "Perfil"}
        email={session.user.email ?? ""}
        image={session.user.image}
        ordersCount={orders.length}
        ticketsCount={tickets.length}
        initialPhone={profile.phone}
        initialHasConsent={profile.hasConsent}
      />

      {/* DJ: acceso al press kit propio. Una cuenta de usuario normal no
          tiene press kit, así que este bloque no existe para ella. */}
      {isDJ && myArtist && (
        <div className="border-chrome mt-10 p-6">
          <h2 className="inline-flex items-center gap-2 text-xl font-bold">
            <Disc3 className="h-4 w-4 text-primary" /> MI PRESS KIT
          </h2>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            Tu perfil público de DJ. Se edita ahí mismo: entrás y cambiás lo que
            veas, sin formularios aparte.
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

      {/* DJ: conversaciones de membresía. No renderiza nada si no hay
          ninguna, y para una cuenta que no es DJ ni siquiera se consulta. */}
      {isDJ && (
        <MembershipInbox
          pending={pending}
          memberships={memberships}
          currentCasa={currentCasa}
        />
      )}

      {/* Crear el perfil de DJ (ALTA-DJ paso 3). Es el primer escalón:
          sin artista no se puede fundar colectivo ni venue, así que va
          antes que los dos. Una cuenta que ya es DJ no lo ve. */}
      {!isDJ && <CrearArtista branches={genreBranches} tags={genreTags} />}

      {/* Crear colectivo (§4.1) y crear venue (§5): uno de cada por
          cuenta, y sólo desde una cuenta de DJ. El que ya existe no
          vuelve a ofrecerse, y tener uno nunca bloquea al otro. */}
      {isDJ && owned.length === 0 && <CreateCollectiveButton branches={genreBranches} tags={genreTags} />}
      {isDJ && ownedVenues.length === 0 && <CreateCollectiveButton entityKind="venue" />}

      {/* Colectivo: el panel del dueño (§4.2, §5.2). Miembros, solicitudes
          pendientes y edición de la info. Una cuenta que no es dueña de
          ningún colectivo no renderiza nada de esto. */}
      {ownedInboxes.map((o) => (
        <CollectiveInbox
          key={o.collective.slug}
          collectiveSlug={o.collective.slug}
          collectiveName={o.collective.name}
          collectiveBio={o.collective.bio}
          collectiveSector={o.collective.sector ?? null}
          pending={o.pending}
          members={o.members}
          departures={o.departures}
        />
      ))}

      {/* Venue: el mismo panel, para el dueño de un venue (§5). */}
      {ownedVenueInboxes.map((o) => (
        <CollectiveInbox
          key={o.collective.slug}
          collectiveSlug={o.collective.slug}
          collectiveName={o.collective.name}
          collectiveBio={o.collective.bio}
          collectiveSector={o.collective.sector ?? null}
          pending={o.pending}
          members={o.members}
          departures={o.departures}
          entityKind="venue"
          address={o.collective.address ?? null}
          capacity={o.collective.capacity ?? null}
        />
      ))}

      {/* Mis pedidos */}
      <div className="mt-16">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Package className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">MIS PEDIDOS</h2>
        </div>

        {orders.length === 0 ? (
          <p className="mt-6 font-mono text-sm text-muted-foreground">
            Todavia no tenes pedidos. Compra entradas o merch desde el carrito.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            {orders.map((o) => (
              <div key={o.id} className="border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs tracking-widest text-muted-foreground">
                    PEDIDO #{o.id} - {new Date(o.createdAt).toLocaleDateString("es-CO")}
                  </div>
                  <span
                    className={`border px-2 py-1 font-mono text-[10px] tracking-widest ${
                      o.status === "paid"
                        ? "border-primary text-primary"
                        : "border-muted-foreground text-muted-foreground"
                    }`}
                  >
                    {STATUS_LABEL[o.status] ?? o.status.toUpperCase()}
                  </span>
                </div>
                <ul className="mt-4 flex flex-col gap-1 font-mono text-sm">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span className="truncate">
                        {it.quantity} {it.name}
                        {it.ticketTier ? ` (${it.ticketTier === "vip" ? "VIP" : "Normal"})` : ""}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
                          it.unitPriceCop * it.quantity
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-border pt-3 text-right font-mono text-sm font-bold">
                  TOTAL:{" "}
                  {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(o.amountCop)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mis tiquetes */}
      <div className="mt-16">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <TicketIcon className="h-4 w-4 text-primary" />
            <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">MIS TIQUETES</h2>
          </div>
          {tickets.length > 0 && (
            <Link
              href="/perfil/tiquetes"
              className="inline-flex items-center gap-1 font-mono text-[10px] tracking-widest text-foreground/70 hover:text-primary"
            >
              VER TODOS <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {tickets.length === 0 ? (
          <p className="mt-6 font-mono text-sm text-muted-foreground">
            Todavia no tenes tiquetes. Se agregan automaticamente cuando compras y pagas una entrada.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {ticketsPreview.map((t) => (
              <Link
                key={t.id}
                href={`/perfil/tiquetes/${t.ticketCode}`}
                className="sheen border-chrome flex flex-col justify-between p-5"
              >
                <TicketIcon className="h-6 w-6 text-chrome" />
                <div className="mt-6">
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    {formatShortDate(t.eventDate)}
                  </div>
                  <div className="mt-1 font-bold leading-tight">
                    <AutoTranslate text={t.eventTitle} />
                  </div>
                  <div className="mt-2 flex items-center gap-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {t.city}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Artistas que me gustan — debajo de MIS TIQUETES. No se renderiza
          si la cuenta no sigue a nadie. */}
      {/* Invitaciones a colaborar (§6.1). Va ANTES de los likes: es lo
          único de esta página que espera una respuesta de quien la mira. */}
      <ColabInbox invitaciones={invitaciones} />

      {/* Tres secciones y no una lista mezclada: para el usuario son
          tres cosas distintas, igual que /artistas, /colectivos y
          /venues son tres secciones. Cada una no se renderiza si está
          vacía, que es la regla de siempre. */}
      <LikedArtists artists={likedArtists} />
      <LikedArtists
        artists={likedColectivos}
        title="COLECTIVOS QUE ME GUSTAN"
        hrefBase="/colectivos"
      />
      <LikedArtists artists={likedVenues} title="VENUES QUE ME GUSTAN" hrefBase="/venues" />
    </section>
  );
}
