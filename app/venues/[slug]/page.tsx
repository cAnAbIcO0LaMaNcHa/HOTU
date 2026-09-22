import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { auth } from "@/auth";
import { AutoTranslate } from "@/components/auto-translate";
import { CollectiveJoinButton } from "@/components/collective-join-button";
import { CollectiveMetrics } from "@/components/collective-metrics";
import { LikeButton } from "@/components/like-button";
import { VenueContactButton } from "@/components/venue-contact-button";
import {
  countCollectiveLikes,
  getCollectiveMembers,
  getMetricasColectivo,
  getMyArtistSlug,
  getPendingForCollective,
  getVenueBySlug,
  hasLikedCollective,
} from "@/lib/db";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const v = await getVenueBySlug(slug);
  if (!v) return {};
  return { title: `${v.name} — Venue`, description: v.bio };
}

/**
 * El press kit de un venue (§5).
 *
 * Es el del colectivo más dirección y aforo, y con una diferencia que no
 * es cosmética: un venue tiene RESIDENTES y no tiene casa. Por eso hay un
 * solo carrusel y no dos. Un DJ toca acá, no vive acá.
 *
 * getVenueBySlug filtra por tipo, así que /venues/<slug-de-colectivo> da
 * notFound en vez de renderizar un colectivo con ficha de venue. El par
 * simétrico lo hace /colectivos/[slug].
 */
export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug, (await auth())?.user?.email ?? null);
  if (!venue) notFound();

  const session = await auth();
  const email = session?.user?.email ?? null;

  const [membersByVenue, pending, myArtistSlug, likeCount, liked, metricas] = await Promise.all([
    getCollectiveMembers("venue"),
    getPendingForCollective(slug),
    email ? getMyArtistSlug(email) : Promise.resolve(null),
    countCollectiveLikes(slug),
    email ? hasLikedCollective(email, slug) : Promise.resolve(false),
    getMetricasColectivo(slug),
  ]);

  const roster = membersByVenue.get(slug) ?? [];

  const alreadyMember = myArtistSlug
    ? roster.some((m) => m.artistSlug === myArtistSlug)
    : false;
  const alreadyPending = myArtistSlug
    ? pending.some((p) => p.artistSlug === myArtistSlug)
    : false;
  const joinState = !email
    ? "signed-out"
    : !myArtistSlug
      ? "no-artist"
      : alreadyMember
        ? "member"
        : alreadyPending
          ? "pending"
          : "can-apply";

  return (
    <section className="mx-auto max-w-5xl px-4 pb-16 pt-16 md:pt-24">
      <h1 className="text-4xl font-bold leading-[0.95] md:text-6xl">{venue.name}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs tracking-widest text-muted-foreground">
        {venue.address && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> {venue.address}
          </span>
        )}
        {!venue.address && venue.sector && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> <AutoTranslate text={venue.sector} />
          </span>
        )}
        {venue.capacity != null && (
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3 w-3" /> <AutoTranslate text="AFORO" /> {venue.capacity}
          </span>
        )}
      </div>

      {venue.bio && (
        <p className="mt-6 max-w-3xl font-mono text-sm leading-relaxed text-muted-foreground">
          <AutoTranslate text={venue.bio} />
        </p>
      )}

{/* SEGUIR (§11). Se muestra al visitante y también al dueño, que no
          tiene por qué quedar escondido de su propio número de seguidores
          — misma regla que el press kit del DJ. */}
      <div className="mt-4">
        <LikeButton
          endpoint={`/api/likes/collectives/${slug}`}
          returnTo={`/venues/${slug}`}
          initialLiked={liked}
          initialCount={likeCount}
          signedIn={!!email}
        />
      </div>

      {/* §5.1: visible para cualquiera, con o sin sesión. Es el punto de
          entrada de quien quiere armar una fiesta acá. */}
      <VenueContactButton venueName={venue.name} />

      {/* Un solo carrusel: RESIDENTES. Un venue no tiene artistas de la
          casa, porque no es la casa de nadie. */}
      {roster.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xl font-bold">RESIDENTES</h2>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {roster.map((m) => (
              <Link
                key={m.artistSlug}
                href={`/artistas/${m.artistSlug}`}
                className="group w-32 shrink-0 text-center"
              >
                <span className="sheen border-chrome flex aspect-square w-full items-center justify-center overflow-hidden rounded-full transition-colors group-hover:border-primary">
                  <span className="text-lg font-bold text-chrome">
                    {m.artistName
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                </span>
                <span className="mt-2 block truncate font-mono text-[11px]">{m.artistName}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* MÉTRICAS del venue (§4.4 + §5). esVenue quita "venues" y
          "ciudades": un venue ES un lugar, contar en cuántos estuvo
          siempre daría uno. */}
      <CollectiveMetrics metricas={metricas} esVenue />

      <CollectiveJoinButton
        collectiveSlug={venue.slug}
        collectiveName={venue.name}
        artistSlug={myArtistSlug}
        state={joinState}
        entityKind="venue"
      />
    </section>
  );
}
