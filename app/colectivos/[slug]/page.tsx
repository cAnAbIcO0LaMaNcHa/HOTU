import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { auth } from "@/auth";
import { AutoTranslate } from "@/components/auto-translate";
import { CollectiveJoinButton } from "@/components/collective-join-button";
import {
  getCollectiveBySlug,
  getCollectiveMembers,
  getMyArtistSlug,
  getPendingForCollective,
} from "@/lib/db";
import { getDistrict } from "@/lib/districts";

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
  const collective = await getCollectiveBySlug(slug);
  if (!collective) notFound();

  const session = await auth();
  const email = session?.user?.email ?? null;

  const [membersByCollective, pending, myArtistSlug] = await Promise.all([
    getCollectiveMembers(),
    getPendingForCollective(slug),
    email ? getMyArtistSlug(email) : Promise.resolve(null),
  ]);

  const roster = membersByCollective.get(slug) ?? [];
  const casa = roster.filter((m) => m.kind === "casa");
  const residentes = roster.filter((m) => m.kind === "residente");
  const district = getDistrict(collective.district);

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
        <span data-district={collective.district}>
          {district.title} · {district.genre}
        </span>
      </div>

      <p className="mt-6 max-w-3xl font-mono text-sm leading-relaxed text-muted-foreground">
        <AutoTranslate text={collective.bio} />
      </p>

      <Roster title="ARTISTAS DE LA CASA" members={casa} />
      <Roster title="ARTISTAS RESIDENTES" members={residentes} />

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
