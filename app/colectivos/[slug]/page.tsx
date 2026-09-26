import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { auth } from "@/auth";
import { AutoTranslate } from "@/components/auto-translate";
import { CollectiveJoinButton } from "@/components/collective-join-button";
import { GeneroEditable } from "@/components/genero-editable";
import { CollectiveContent } from "@/components/collective-content";
import { CollectiveMetrics } from "@/components/collective-metrics";
import { LikeButton } from "@/components/like-button";
import { canEditCollective } from "@/lib/collectives-write";
import { hayReclamoAbierto, reclamabilidad, tieneReclamoAbierto } from "@/lib/claims-write";
import { ReclamarPerfil } from "@/components/reclamar-perfil";
import {
  countCollectiveLikes,
  getCollectiveBySlug,
  getMetricasColectivo,
  getCollectiveSets,
  getCollectiveTracks,
  getGenreBranches,
  getGenreTags,
  getProfileGenres,
  getCollectiveMembers,
  getMyArtistSlug,
  getPendingForCollective,
  hasLikedCollective,
} from "@/lib/db";

export const revalidate = 0;

/**
 * The collective's page — the MINIMUM of §4.3 that the membership flow
 * needs to be usable: header, the two member carousels, and the join
 * button that starts the conversation.
 *
 * Sets, tracks, events and metrics are the rest of that section and belong
 * to pieza 7. This exists now because ÚNETE A NOSOTROS is the entry point
 * of everything in pieza 3, and a button needs a page to live on.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCollectiveBySlug(slug);
  if (!c) return {};
  return { title: `${c.name} — Colectivo`, description: c.bio };
}

export default async function CollectivePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // La sesión PRIMERO: getCollectiveBySlug la necesita para decidir si
  // sirve un colectivo censurado, que su dueño sí tiene que poder ver.
  const session = await auth();
  const email = session?.user?.email ?? null;

  const collective = await getCollectiveBySlug(slug, "collective", email);
  if (!collective) notFound();

  const [membersByCollective, pending, myArtistSlug] = await Promise.all([
    getCollectiveMembers(),
    getPendingForCollective(slug),
    email ? getMyArtistSlug(email) : Promise.resolve(null),
  ]);

  // El dueño edita desde su propio perfil (§4.2), pero el género se
  // edita acá, que es donde se ve. Misma regla que el press kit del DJ.
  const puedeEditar = await canEditCollective(slug, email);

  /**
   * Reclamable incluye "tiene dueño pero es cuenta fantasma", no solo
   * "sin dueño": los 6 colectivos de producción TIENEN dueño y es una
   * cuenta con la que no se puede entrar. Preguntar por owner_email IS
   * NULL dejaría afuera justo a los que hacen falta.
   */
  const puedeReclamarse = puedeEditar ? null : await reclamabilidad("collective", slug);
  const yaReclamado = email && puedeReclamarse?.puede
    ? await tieneReclamoAbierto(email, "collective", slug)
    : false;
  const reclamosAbiertos = puedeReclamarse?.puede
    ? await hayReclamoAbierto("collective", slug)
    : 0;
  const genero = await getProfileGenres("collective", slug);
  const [branches, allTags] = puedeEditar
    ? await Promise.all([getGenreBranches(), getGenreTags()])
    : [[], []];

  // Las dos en paralelo: son independientes y cada sql del driver HTTP
  // es su propio round-trip.
  const [likeCount, liked, sets, tracks, metricas] = await Promise.all([
    countCollectiveLikes(slug),
    email ? hasLikedCollective(email, slug) : Promise.resolve(false),
    getCollectiveSets(slug),
    getCollectiveTracks(slug),
    getMetricasColectivo(slug),
  ]);

  const roster = membersByCollective.get(slug) ?? [];
  const casa = roster.filter((m) => m.kind === "casa");
  const residentes = roster.filter((m) => m.kind === "residente");

  // Why the join button is or is not actionable, decided here so the
  // button itself never has to guess.
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
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      {/* Arriba de todo para quien no lo administra: es lo único que esa
          persona puede hacer con este perfil. */}
      {puedeReclamarse?.puede && (
        <div className="mb-8">
          <ReclamarPerfil
            tipo="collective"
            slug={slug}
            nombre={collective.name}
            haySesion={Boolean(email)}
            yaReclamado={yaReclamado}
            razon={puedeReclamarse.razon}
            abiertos={reclamosAbiertos}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-bold leading-[0.95] md:text-6xl">{collective.name}</h1>
        <span
          className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${
            collective.type === "HOTU"
              ? "border-primary text-primary"
              : "border-muted-foreground text-muted-foreground"
          }`}
        >
          {collective.type === "HOTU" ? "BY HOTU" : "LOCAL"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs tracking-widest text-muted-foreground">
        {collective.sector && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> <AutoTranslate text={collective.sector} />
          </span>
        )}
      </div>

      <p className="mt-6 max-w-3xl font-mono text-sm leading-relaxed text-muted-foreground">
        <AutoTranslate text={collective.bio} />
      </p>

      {/* SEGUIR (§11). Se muestra al visitante y también al dueño, que no
          tiene por qué quedar escondido de su propio número de seguidores
          — misma regla que el press kit del DJ. */}
      <div className="mt-4">
        <LikeButton
          endpoint={`/api/likes/collectives/${slug}`}
          returnTo={`/colectivos/${slug}`}
          initialLiked={liked}
          initialCount={likeCount}
          signedIn={!!email}
        />
      </div>

      {/* GÉNERO. Mismo componente y misma regla que el artista: los seis
          colectivos anteriores a la taxonomía no tienen ninguno, y este
          es el único lugar donde su dueño lo puede completar. */}
      <GeneroEditable
        owner="collective"
        slug={collective.slug}
        genero={genero}
        branches={branches}
        tags={allTags}
        canEdit={puedeEditar}
      />

      <Roster title="ARTISTAS DE LA CASA" members={casa} />
      <Roster title="ARTISTAS RESIDENTES" members={residentes} />

      {/* SETS y TRACKS (§6). Van DESPUÉS de los rosters a propósito:
          primero quién es el colectivo, después qué suena. Lo que se ve
          acá sale de dos orígenes —la casa actual de cada autor y los
          placements congelados— y la consulta los une, así que esta
          sección no sabe ni tiene por qué saber de cuál vino cada pieza. */}
      <CollectiveContent sets={sets} tracks={tracks} collectiveName={collective.name} />

      {/* MÉTRICAS (§4.4), al final del press kit y solo de lo que
          organizó. Sin eventos organizados no se renderiza: hoy ninguno
          tiene organizador asignado, y un bloque en cero informaría que
          no organizó nada cuando lo que pasa es que falta el dato. */}
      <CollectiveMetrics metricas={metricas} />

      <CollectiveJoinButton
        collectiveSlug={collective.slug}
        collectiveName={collective.name}
        artistSlug={myArtistSlug}
        state={joinState}
      />
    </section>
  );
}

/** An empty carousel is not rendered — the profile grows with the crew. */
function Roster({
  title,
  members,
}: {
  title: string;
  members: { artistSlug: string; artistName: string }[];
}) {
  if (members.length === 0) return null;
  return (
    <div className="mt-12">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {members.map((m) => (
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
  );
}
