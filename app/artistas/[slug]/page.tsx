import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { EpkHeader } from "@/components/epk-header";
import { EpkAbout } from "@/components/epk-about";
import { EpkSets } from "@/components/epk-sets";
import { EpkTracks } from "@/components/epk-tracks";
import { EpkEvents } from "@/components/epk-events";
import { LikeButton } from "@/components/like-button";
import { FranjaRevision } from "@/components/franja-revision";
import { GeneroEditable } from "@/components/genero-editable";
import { canEditArtist, loQueFalta } from "@/lib/artists-write";
import { casaActual } from "@/lib/collaborators-write";
import {
  countArtistLikes,
  getArtistBySlug,
  getGenreBranches,
  getGenreTags,
  getProfileGenres,
  getGigsByArtist,
  getSetsByArtist,
  getTracksByArtist,
  hasLikedArtist,
  getCandidatosColab,
} from "@/lib/db";

export const revalidate = 0;

/**
 * El título tampoco puede delatar un borrador. Sin el email del que
 * mira, getArtistBySlug solo devuelve publicados, así que un borrador
 * ajeno sale sin metadata, igual que un slug que no existe.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const session = await auth();
  const artist = await getArtistBySlug(slug, session?.user?.email ?? null);
  if (!artist) return {};
  return { title: `${artist.name} — Bio, sets y tracks`, description: artist.bio };
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // La sesión va ANTES de leer el artista: un borrador solo lo ve su
  // dueño o un SUPER_ADMIN, y para decidirlo hay que saber quién mira.
  const session = await auth();
  const email = session?.user?.email ?? null;

  const artist = await getArtistBySlug(slug, email);
  // notFound() y nunca un 403. Un 403 confirmaría que el slug existe, y
  // con eso se enumeran los borradores probando nombres. Para quien no
  // puede verlo, el perfil no existe.
  if (!artist) notFound();

  // Same check the API route runs before accepting a write. Hiding the edit
  // controls is presentation; the route is what actually protects the data.
  const [canEdit, sets, tracks, gigs, likeCount, liked] = await Promise.all([
    canEditArtist(slug, email),
    getSetsByArtist(slug),
    getTracksByArtist(slug),
    getGigsByArtist(slug),
    countArtistLikes(slug),
    email ? hasLikedArtist(email, slug) : Promise.resolve(false),
  ]);

  // Qué le falta al perfil, solo si quien mira lo puede editar: es lo
  // único que hace falta para la franja, y para un visitante ese cálculo
  // no tendría a quién mostrarse.
  const faltantes = canEdit ? await loQueFalta(slug) : [];

  // Para publicar: a quién se puede invitar, y si el artista tiene casa
  // hoy. Las dos SOLO si quien mira puede editar — un visitante no abre
  // el formulario nunca, y pedirle a la base la lista entera de
  // candidatos para no usarla sería trabajo puro.
  const [candidatos, casa] = canEdit
    ? await Promise.all([getCandidatosColab(), casaActual(slug)])
    : [[], null];
  const sinCasa = casa === null;

  // El género declarado, y el vocabulario SOLO si puede editarlo: los 719
  // tags son para el selector, y un visitante no lo abre nunca.
  const genero = await getProfileGenres("artist", slug);
  const [branches, allTags] = canEdit
    ? await Promise.all([getGenreBranches(), getGenreTags()])
    : [[], []];

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      {/* La franja de revisión, solo para el dueño y el admin. Un
          visitante nunca llega acá con un perfil sin publicar: le da 404. */}
      {canEdit && (
        <FranjaRevision
          slug={slug}
          reviewStatus={artist.reviewStatus}
          reviewNote={artist.reviewNote}
          faltantes={faltantes}
        />
      )}

      <EpkHeader artist={artist} canEdit={canEdit} />

      {/* Following is not editing: it shows for visitors, and for the owner
          too, who has no reason to be hidden from their own follower count. */}
      <div className="mt-4">
        <LikeButton
          endpoint={`/api/likes/artists/${slug}`}
          returnTo={`/artistas/${slug}`}
          initialLiked={liked}
          initialCount={likeCount}
          signedIn={!!email}
        />
      </div>

      {/* genero.primary decide si "Sobre mí" muestra el género viejo de
          texto libre: es el suplente de la sección GÉNERO de acá abajo,
          que no se renderiza vacía para un visitante. */}
      <EpkAbout
        artist={artist}
        canEdit={canEdit}
        tieneGeneroDeclarado={genero.primary !== null}
      />

      {/* GÉNERO, justo después de SOBRE MÍ. Es la regla en la EDICIÓN:
          los perfiles anteriores a la taxonomía no tienen género y nunca
          pasaron por el formulario de alta, así que este es el único
          lugar donde lo pueden completar. */}
      <GeneroEditable
        owner="artist"
        slug={slug}
        genero={genero}
        branches={branches}
        tags={allTags}
        canEdit={canEdit}
      />

      {/* DJ SETS and TRACKS are two separate sections, never tabs. */}
      {/* candidatos y sinCasa solo hacen falta para publicar, así que
          se cargan únicamente cuando quien mira puede editar. */}
      <EpkSets
        sets={sets}
        canEdit={canEdit}
        artistSlug={slug}
        candidatos={candidatos}
        sinCasa={sinCasa}
      />
      <EpkTracks
        tracks={tracks}
        canEdit={canEdit}
        artistSlug={slug}
        candidatos={candidatos}
        sinCasa={sinCasa}
      />
      <EpkEvents gigs={gigs} canEdit={canEdit} currentYear={new Date().getFullYear()} />
    </section>
  );
}
