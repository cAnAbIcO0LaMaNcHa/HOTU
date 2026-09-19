import Link from "next/link";
import { CollectiveInbox } from "@/components/collective-inbox";
import { CreateCollectiveButton } from "@/components/create-collective-button";
import { SalirDelColectivo } from "@/components/salir-del-colectivo";
import { PanelVacio } from "@/components/panel-switcher";
import type { EntityKind } from "@/lib/db";
import {
  getCollectiveMembers,
  getCollectivesOwnedBy,
  getGenreBranches,
  getGenreTags,
  getMyArtistSlug,
  getMyMemberships,
  getPendingForCollective,
  getRecentDepartures,
} from "@/lib/db";

/**
 * Panel COLECTIVO — y también VENUE, que es el mismo con otro
 * entity_kind.
 *
 * Dos mitades distintas, y la diferencia importa:
 *
 *   EL QUE ADMINISTRO — si sos dueño. Miembros, solicitudes pendientes,
 *                       edición de la info. Es el panel completo.
 *   LOS QUE INTEGRO   — solo ver, con la opción de salirte. No sos dueño,
 *                       así que no editás nada de ellos.
 *
 * Un mismo componente para colectivos y venues porque comparten tabla y
 * el panel es idéntico; lo único que cambia son las palabras y a qué
 * sección del sitio linkea. Duplicar el archivo para cambiar tres textos
 * habría sido una copia disfrazada — y el umbral de condicionales de
 * entity_kind que AGENTS.md pide vigilar sube igual, así que si esto se
 * empieza a llenar de ifs hay que volver a mirarlo.
 */
export async function PanelColectivo({
  email,
  kind = "collective",
}: {
  email: string;
  kind?: EntityKind;
}) {
  const esVenue = kind === "venue";
  const palabra = esVenue ? "venue" : "colectivo";
  const seccion = esVenue ? "/venues" : "/colectivos";

  // Estas dos primero y solas: deciden si hay algo que mostrar. Las
  // consultas caras van después, y solo si hacen falta.
  const [myArtistSlug, propios] = await Promise.all([
    getMyArtistSlug(email),
    getCollectivesOwnedBy(email, kind),
  ]);

  /**
   * SIN PERFIL DE DJ **Y** SIN NADA PROPIO: la invitación al escalón
   * anterior. createCollective exige un artista publicado, así que
   * ofrecer el botón mandaría a la persona contra un 403.
   *
   * El "Y" es lo que importa y me lo comí en la primera versión: había
   * atado el panel entero a tener artista, y eso le sacaba el panel de
   * administración a quien es DUEÑO DE UN COLECTIVO SIN SER DJ.
   * colectivo@test.hotu.local es exactamente ese caso —dueño de OTU, sin
   * artista— y se quedaba sin forma de responder solicitudes ni editar la
   * info. La página vieja los renderizaba sin mirar si eras DJ.
   *
   * Ser dueño y ser DJ son dos cosas distintas: hoy el alta exige artista
   * pero nada en el schema lo impone, y una migración o un traspaso de
   * dueño pueden dejar a alguien administrando sin perfil propio.
   */
  if (!myArtistSlug && propios.length === 0) {
    return (
      <PanelVacio
        titulo={esVenue ? "REGISTRÁ TU VENUE" : "CREÁ TU COLECTIVO"}
        explicacion={
          esVenue
            ? "Un venue tiene su página, sus residentes, sus eventos y sus métricas. Pero primero necesitás un perfil de DJ: los venues se registran desde una cuenta de artista."
            : "Un colectivo tiene su página, sus artistas, el contenido de su casa y sus métricas. Pero primero necesitás un perfil de DJ: los colectivos se fundan desde una cuenta de artista."
        }
      >
        <Link
          href="/perfil?panel=artista"
          className="surface-chrome sheen inline-flex px-4 py-2 font-mono text-[10px] font-bold tracking-[0.2em]"
        >
          CREAR MI PERFIL DE DJ
        </Link>
      </PanelVacio>
    );
  }

  // Sin artista no hay membresías: getMyMemberships las busca por el
  // dueño del artista. Preguntarlo sería un viaje garantizado a vacío.
  const memberships = myArtistSlug ? await getMyMemberships(email) : [];

  // De los que integro, solo los de este tipo, y sin los que ya administro
  // —ahí aparecen arriba con el panel completo, listarlos dos veces sería
  // decir que son dos cosas.
  const propiosSlugs = new Set(propios.map((c) => c.slug));
  const integro = memberships.filter(
    (m) => (m.entityKind ?? "collective") === kind && !propiosSlugs.has(m.collectiveSlug)
  );

  const miembros = propios.length > 0 ? await getCollectiveMembers(kind) : new Map();
  const paneles = await Promise.all(
    propios.map(async (c) => ({
      collective: c,
      pending: await getPendingForCollective(c.slug),
      members: miembros.get(c.slug) ?? [],
      departures: await getRecentDepartures(c.slug, 5),
    }))
  );

  const necesitaVocabulario = !esVenue && propios.length === 0;
  const [branches, tags] = necesitaVocabulario
    ? await Promise.all([getGenreBranches(), getGenreTags()])
    : [[], []];

  return (
    <>
      {propios.length === 0 && integro.length === 0 && (
        <PanelVacio
          titulo={esVenue ? "REGISTRÁ TU VENUE" : "CREÁ TU COLECTIVO O UNITE A UNO"}
          explicacion={
            esVenue
              ? "Si tenés un lugar donde suena música, registralo: va a tener su página, sus residentes, sus eventos y sus métricas. Uno por cuenta."
              : "Un colectivo es tu crew: su página, sus artistas, el contenido de quienes lo tienen como casa, y sus métricas. Podés fundar uno —uno por cuenta— o pedir entrar a uno que ya exista desde su página."
          }
        >
          <Link
            href={seccion}
            className="inline-flex border border-border px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary"
          >
            {esVenue ? "VER LOS VENUES" : "VER LOS COLECTIVOS"}
          </Link>
        </PanelVacio>
      )}

      {/* Crear: uno de cada por cuenta, y el que ya existe no se vuelve a
          ofrecer. Tener un colectivo nunca bloquea tener un venue. */}
      {propios.length === 0 && myArtistSlug &&
        (esVenue ? (
          <CreateCollectiveButton entityKind="venue" />
        ) : (
          <CreateCollectiveButton branches={branches} tags={tags} />
        ))}

      {/* El que administro: panel completo. */}
      {paneles.map((o) => (
        <CollectiveInbox
          key={o.collective.slug}
          collectiveSlug={o.collective.slug}
          collectiveName={o.collective.name}
          collectiveBio={o.collective.bio}
          collectiveSector={o.collective.sector ?? null}
          pending={o.pending}
          members={o.members}
          departures={o.departures}
          {...(esVenue
            ? {
                entityKind: "venue" as const,
                address: o.collective.address ?? null,
                capacity: o.collective.capacity ?? null,
              }
            : {})}
        />
      ))}

      {/* Los que integro: solo ver, y salirme. */}
      {integro.length > 0 && (
        <div className="mt-16">
          <div className="border-b border-border pb-4">
            <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
              {esVenue ? "VENUES QUE INTEGRO" : "COLECTIVOS QUE INTEGRO"}
            </h2>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              No los administrás: solo el dueño edita. Podés salirte cuando quieras.
            </p>
          </div>
          <div className="mt-6 space-y-3">
            {integro.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-border p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`${seccion}/${m.collectiveSlug}`}
                    className="font-bold hover:text-primary"
                  >
                    {m.collectiveName}
                  </Link>
                  <div className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                    {m.kind === "casa" ? "MI CASA" : "RESIDENTE"}
                  </div>
                </div>
                {/* Solo hay algo de lo que salirse si hay artista: las
                    membresías son del artista, no de la cuenta. */}
                {myArtistSlug && (
                  <SalirDelColectivo
                    collectiveSlug={m.collectiveSlug}
                    collectiveName={m.collectiveName}
                    artistSlug={myArtistSlug}
                    esCasa={m.kind === "casa"}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
