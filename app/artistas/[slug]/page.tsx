import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { EpkHeader } from "@/components/epk-header";
import { EpkAbout } from "@/components/epk-about";
import { EpkSets } from "@/components/epk-sets";
import { EpkTracks } from "@/components/epk-tracks";
import { EpkEvents } from "@/components/epk-events";
import { ArtistLikeButton } from "@/components/artist-like-button";
import { canEditArtist } from "@/lib/artists-write";
import {
  countArtistLikes,
  getArtistBySlug,
  getGigsByArtist,
  getSetsByArtist,
  getTracksByArtist,
  hasLikedArtist,
} from "@/lib/db";

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) return {};
  return { title: `${artist.name} — Bio, sets y tracks`, description: artist.bio };
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) notFound();

  // Same check the API route runs before accepting a write. Hiding the edit
  // controls is presentation; the route is what actually protects the data.
  const session = await auth();
  const email = session?.user?.email ?? null;
  const [canEdit, sets, tracks, gigs, likeCount, liked] = await Promise.all([
    canEditArtist(slug, email),
    getSetsByArtist(slug),
    getTracksByArtist(slug),
    getGigsByArtist(slug),
    countArtistLikes(slug),
    email ? hasLikedArtist(email, slug) : Promise.resolve(false),
  ]);

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <EpkHeader artist={artist} canEdit={canEdit} />

      {/* Following is not editing: it shows for visitors, and for the owner
          too, who has no reason to be hidden from their own follower count. */}
      <div className="mt-4">
        <ArtistLikeButton
          artistSlug={slug}
          initialLiked={liked}
          initialCount={likeCount}
          signedIn={!!email}
        />
      </div>

      <EpkAbout artist={artist} canEdit={canEdit} />

      {/* DJ SETS and TRACKS are two separate sections, never tabs. */}
      <EpkSets sets={sets} canEdit={canEdit} artistSlug={slug} />
      <EpkTracks tracks={tracks} canEdit={canEdit} artistSlug={slug} />
      <EpkEvents gigs={gigs} canEdit={canEdit} currentYear={new Date().getFullYear()} />
    </section>
  );
}
