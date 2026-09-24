import { neon } from "@neondatabase/serverless";
// roles-check y no roles.ts: el primero no importa @/auth, así que no
// arrastra nada de next-auth acá.
import { isModerator, isSuperAdmin } from "./roles-check";

const sql = neon(process.env.DATABASE_URL!);

/**
 * artists.sets, artists.top_tracks and collectives.artist_slugs are NOT
 * mapped here any more. They were prototype placeholders (every url was
 * "#") that duplicated data now living in dj_sets, tracks and
 * artist_collectives, and nothing renders them. The columns still exist as
 * a fallback, but keeping them on the types would invite somebody to start
 * reading them again by accident.
 */

/** Shared editorial fields every content entity now carries. */
export type ContentMeta = {
  scope: "global" | "country";
  countryCode: string;
  language: string;
  status: "draft" | "published" | "archived";
  featured: boolean;
  priorityAt: string | null;
  /**
   * La marca de moderación (tanda 5 §4). null = no censurado.
   *
   * Va en ContentMeta y no en cada tipo porque las seis tablas
   * editoriales la tienen, igual que status. Y va SEPARADA de status a
   * propósito: status es si el AUTOR quiere que se vea, esto es si un
   * MODERADOR lo bajó, y los dos pueden ser verdad a la vez.
   *
   * Los lectores públicos ya filtran por censored_at IS NULL en el SQL,
   * así que esto solo llega con valor cuando quien mira es el dueño o
   * un moderador — que son los únicos que tienen que leer el motivo.
   */
  censoredAt: string | null;
  censorReason: string | null;
};

/**
 * The EPK's social row. Every key is optional — the profile grows with the
 * artist, and an empty platform is simply not rendered.
 *
 * Defined in lib/socials.ts, not here: client components need the list as a
 * runtime value, and importing a value from this module would drag the neon
 * client into the browser bundle. Re-exported so server-side callers do not
 * have to care.
 */
export {
  SOCIAL_PLATFORMS,
  SOCIAL_LABELS,
  type SocialPlatform,
  type ArtistSocials,
} from "./socials";

import type { ArtistSocials } from "./socials";

export type Artist = ContentMeta & {
  slug: string;
  name: string;
  genre: string;
  city: string;
  photo?: string;
  bio: string;
  joinedAt: string;
  /** EPK fields added in tanda 1. */
  coverUrl?: string;
  /** The line under the name in the header, e.g. "DJ & Productor". */
  role?: string;
  /** Public booking address, NOT the address the owner logs in with. */
  contactEmail?: string;
  /** Public booking phone, NOT user_profiles.phone, which is private. */
  contactPhone?: string;
  /** Where they are from, as opposed to `city`, where they live now. */
  origin?: string;
  bpmMin?: number;
  bpmMax?: number;
  /** The code buyers type at checkout so the sale is credited to this DJ.
   *  Matched case-insensitively: CAMILA and camila are the same code. */
  djCode?: string;
  socials: ArtistSocials;
  /**
   * Dónde está en la cola de aprobación. Es distinto de `status`, que es
   * la visibilidad editorial: uno dice si es público y el otro dónde está
   * en la revisión. Ver la migración setup-artist-signup.
   */
  reviewStatus: "borrador" | "en_revision" | "rechazado" | "aprobado";
  /** El motivo del rechazo, que lee el DJ. Solo con 'rechazado'. */
  reviewNote?: string;
};

export type Track = ContentMeta & {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
  releasedAt: string;
  url: string;
  /** Tanda 2: cover art, imprint, and a manual position. */
  coverUrl?: string;
  label?: string;
  /** NULL means "no manual position" — readers fall back to the date. */
  sortOrder?: number;
};

export type DjSet = ContentMeta & {
  slug: string;
  title: string;
  artistName: string;
  artistSlug?: string;
  duration: string;
  recordedAt: string;
  url: string;
  coverUrl?: string;
  sortOrder?: number;
};

/**
 * Colectivo y venue comparten la tabla `collectives` (tanda 3, §5). Para
 * el usuario son dos secciones distintas, con su propia navegación; para
 * la base son la misma fila con un tipo distinto.
 *
 * TODA lectura de esta tabla tiene que decir cuál de los dos quiere. El
 * default es 'collective' en todos lados, así que olvidarse deja fuera a
 * los venues en vez de mezclarlos: si algo falla, falla mostrando de
 * menos, nunca publicando un venue como si fuera un colectivo.
 */
export type EntityKind = "collective" | "venue";

export type Collective = ContentMeta & {
  slug: string;
  name: string;
  type: "HOTU" | "LOCAL";
  sector: string;
  bio: string;
  entityKind: EntityKind;
  /** Solo venues. Un colectivo no tiene dirección propia. */
  address?: string;
  /** Solo venues. Aforo. */
  capacity?: number;
};

/*
 * status_membership is no longer mapped. The 3-DJs/2-residents minimum was
 * removed in tanda 3 (§1.1): there is no publishable/incomplete state, and
 * a collective with one member can publish. The column still exists in the
 * table, frozen — a column is never dropped in the same migration that
 * stops using it — but it is not read, not written, and not on the type,
 * so nothing can start depending on it again by accident.
 */

export type EventItem = ContentMeta & {
  id: number;
  date: string;
  endAt: string | null;
  flyerUrl: string | null;
  city: string;
  venue: string;
  title: string;
  /**
   * El texto libre del flyer. CONGELADO desde §7: sigue guardándose y
   * mostrándose, pero la relación de verdad es event_lineup. Es la única
   * prueba de qué decía el flyer, así que no se borra.
   */
  lineup: string;
  /** El colectivo o venue que lo organiza (§7). NULL = todavía sin asignar. */
  organizerSlug: string | null;
  /**
   * Cuándo una persona revisó el lineup relacionado. NULL = sin revisar.
   *
   * "Revisado" NO es "todo resuelto": un nombre puede no corresponder a
   * nadie para siempre —un invitado sin perfil, una crew que se
   * disolvió—, y exigir resolverlo todo dejaría eventos marcados como
   * pendientes eternamente.
   */
  lineupReviewedAt: string | null;
};

/** Una entrada del lineup de un evento (§7). */
export type LineupEntry = {
  /** El texto como aparecía en el flyer. SIEMPRE está. */
  rawName: string;
  /** A quién se resolvió, si se resolvió. Los dos null = texto suelto. */
  artistSlug: string | null;
  collectiveSlug: string | null;
};

/**
 * El lineup de varios eventos de una sola consulta, agrupado por evento.
 *
 * De a muchos y no uno por evento: la grilla de /eventos pinta hasta
 * veinte tarjetas, y cada sql del driver HTTP de Neon es su propio
 * round-trip. Veinte consultas para pintar una lista serían veinte
 * viajes donde alcanza uno.
 *
 * Un evento SIN entradas no aparece en el Map, y eso es información, no
 * un vacío: significa que su lineup todavía no se importó, y quien
 * renderiza tiene que caer al texto congelado de events.lineup. Es la
 * regla de la transición — entre que la migración corre y el import
 * corre, el visitante tiene que seguir viendo el lineup igual que
 * siempre.
 */
export async function getLineupsByEvent(
  eventIds: number[]
): Promise<Map<number, LineupEntry[]>> {
  const porEvento = new Map<number, LineupEntry[]>();
  if (eventIds.length === 0) return porEvento;

  const rows = await sql`
    SELECT event_id, raw_name, artist_slug, collective_slug
    FROM event_lineup
    WHERE event_id = ANY(${eventIds}::int[])
    ORDER BY event_id, position, id
  `;

  for (const r of rows) {
    const id = r.event_id as number;
    if (!porEvento.has(id)) porEvento.set(id, []);
    porEvento.get(id)!.push({
      rawName: r.raw_name as string,
      artistSlug: (r.artist_slug as string | null) ?? null,
      collectiveSlug: (r.collective_slug as string | null) ?? null,
    });
  }
  return porEvento;
}

/** Las métricas de un colectivo o venue (§4.4). */
export type MetricasColectivo = {
  eventos: number;
  venues: number;
  ciudades: number;
};

/**
 * Las métricas de un colectivo o un venue (§4.4).
 *
 * SOLO DE EVENTOS QUE ORGANIZÓ. Nunca la suma de los toques de sus
 * miembros: un colectivo de diez DJs acumularía miles de horas que no
 * son suyas. Por eso todo sale de events.organizer_slug y no hay un solo
 * JOIN contra artist_collectives acá.
 *
 * Sirve igual para un venue, porque organizer_slug apunta a la tabla que
 * guarda los dos y §5 le da métricas propias al venue.
 *
 * ============================================================
 * DOS DE LAS CUATRO MÉTRICAS DE §4.4 CAMBIARON, Y NO POR CAPRICHO
 * ============================================================
 *
 * §4.3 punto 6 pedía "horas, eventos, distritos, venues". De esas:
 *
 * DISTRITOS YA NO EXISTE. El sistema de distritos se retiró entero en la
 * tanda 4 §3: las columnas quedaron congeladas y nadie las lee. Contar
 * distritos hoy sería resucitar un concepto muerto para llenar un
 * casillero. En su lugar va CIUDADES, que es lo que esa métrica quería
 * decir —en cuántos lugares distintos armaron algo— y que sí es un dato
 * vivo.
 *
 * HORAS NO SE PUEDE CALCULAR, y por eso no está. No es que falte el
 * dato: falta la COLUMNA. events.event_date es un DATE —sin hora— así
 * que un evento no guarda a qué hora empezó. Con solo end_at, la resta
 * mide desde la MEDIANOCHE del día del evento, no desde que empezó la
 * fiesta: una prueba con un cierre ocho horas después del inicio devolvió
 * 13 horas.
 *
 * Un número equivocado es peor que ninguno — más todavía en una métrica
 * que un colectivo va a mostrarle a un organizador para que lo contrate.
 * Queda anotado en PROGRESO.md: para tener horas hace falta una hora de
 * inicio en events, y eso es modelo nuevo, no un cálculo.
 */
export async function getMetricasColectivo(slug: string): Promise<MetricasColectivo> {
  const [r] = await sql`
    SELECT
      COUNT(*)::int AS eventos,
      COUNT(DISTINCT lower(venue))::int AS venues,
      COUNT(DISTINCT lower(city))::int AS ciudades
    FROM events
    WHERE organizer_slug = ${slug} AND status = 'published' AND censored_at IS NULL
  `;

  return {
    eventos: (r?.eventos as number) ?? 0,
    venues: (r?.venues as number) ?? 0,
    ciudades: (r?.ciudades as number) ?? 0,
  };
}

export type NewsItem = ContentMeta & {
  id: number;
  tag: string;
  date: string;
  title: string;
  excerpt: string;
};

/** Options accepted by every list-read function below. */
export type ReadOptions = {
  /** When true, returns drafts/archived rows too — for admin screens only. */
  includeAll?: boolean;
};

// Pure date helpers live in ./date-utils, which has zero dependency on
// this file's `neon()` connection — re-exported here so existing server
// code can keep importing them from "@/lib/db" unchanged, while client
// components import straight from "@/lib/date-utils" to avoid pulling
// the database client (and DATABASE_URL) into the browser bundle.
export { toISODate, formatShortDate, eventHasEnded } from "./date-utils";
import { toISODate } from "./date-utils";

function mapMeta(r: Record<string, unknown>): ContentMeta {
  return {
    scope: (r.scope as ContentMeta["scope"]) ?? "country",
    countryCode: (r.country_code as string) ?? "COL",
    language: (r.language as string) ?? "es",
    status: (r.status as ContentMeta["status"]) ?? "published",
    featured: Boolean(r.featured),
    priorityAt: r.priority_at ? new Date(r.priority_at as string).toISOString() : null,
    censoredAt: r.censored_at ? new Date(r.censored_at as string).toISOString() : null,
    censorReason: (r.censor_reason as string | null) ?? null,
  };
}

/** Single place the artists table is turned into an Artist, so the list
 *  and the profile can never drift apart on which columns they read. */
function mapArtist(r: Record<string, unknown>): Artist {
  return {
    ...mapMeta(r),
    slug: r.slug as string,
    name: r.name as string,
    genre: r.genre as string,
    city: r.city as string,
    photo: (r.photo as string) ?? undefined,
    bio: r.bio as string,
    joinedAt: toISODate(r.joined_at as string),
    coverUrl: (r.cover_url as string) ?? undefined,
    role: (r.role as string) ?? undefined,
    contactEmail: (r.contact_email as string) ?? undefined,
    contactPhone: (r.contact_phone as string) ?? undefined,
    origin: (r.origin as string) ?? undefined,
    bpmMin: r.bpm_min === null || r.bpm_min === undefined ? undefined : Number(r.bpm_min),
    bpmMax: r.bpm_max === null || r.bpm_max === undefined ? undefined : Number(r.bpm_max),
    djCode: (r.dj_code as string) ?? undefined,
    socials: (r.socials ?? {}) as ArtistSocials,
    // Las filas anteriores a la migración no tienen la columna en algunos
    // lectores viejos; 'aprobado' es el default seguro porque es el que la
    // migración le puso a todo lo que ya estaba publicado.
    reviewStatus: (r.review_status as Artist["reviewStatus"]) ?? "aprobado",
    reviewNote: (r.review_note as string) ?? undefined,
  };
}

export async function getAllArtists(opts: ReadOptions = {}): Promise<Artist[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM artists ORDER BY joined_at DESC`
    : await sql`SELECT * FROM artists WHERE status = 'published' AND censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_profiles u WHERE lower(u.email) = lower(artists.owner_email) AND u.banned_at IS NOT NULL) ORDER BY joined_at DESC`;
  return rows.map(mapArtist);
}

/**
 * El artista con ese slug, si quien mira puede verlo.
 *
 * Publicado, lo ve cualquiera. Sin publicar, SOLO su dueño y un
 * SUPER_ADMIN: un perfil recién creado nace en borrador y su dueño tiene
 * que poder llenarlo antes de mandarlo a revisar, cosa que hasta ahora
 * era imposible porque este lector filtraba por status y le daba 404 a
 * su propia cara.
 *
 * DEVUELVE undefined, NO UN ERROR DE PERMISO. Quien llama hace
 * notFound(), así que un borrador ajeno contesta 404 y no 403. Un 403
 * confirmaría que el slug existe, y con eso se enumeran los borradores
 * probando nombres. Para quien no puede verlo, el perfil no existe.
 *
 * Sin viewerEmail se comporta como antes: solo publicados. Así el que se
 * olvida de pasarlo muestra de menos y nunca de más.
 */
export async function getArtistBySlug(
  slug: string,
  viewerEmail?: string | null
): Promise<Artist | undefined> {
  const rows = await sql`SELECT * FROM artists WHERE slug = ${slug}`;
  if (rows.length === 0) return undefined;

  const artist = mapArtist(rows[0]);
  /**
   * CENSURADO = NO EXISTE, para cualquiera menos su dueño.
   *
   * Se chequea acá y no en el SELECT porque esta función también sirve
   * al dueño su propio borrador. Un perfil censurado sigue siendo
   * visible para su dueño —tiene que poder leer el motivo— y deja de
   * serlo para todos los demás.
   */
  // Ahora sí sale del objeto mapeado, porque mapMeta lo escribe. La
  // primera versión lo leía de ahí cuando NADIE lo escribía, así que
  // daba undefined siempre y el chequeo no chequeaba nada.
  const censurado = artist.censoredAt != null;
  if (artist.status === "published" && !censurado && !(await duenoBaneado(artist.slug))) {
    return artist;
  }

  if (!viewerEmail) return undefined;
  const owner = (rows[0].owner_email as string | null) ?? null;
  if (owner && owner.toLowerCase() === viewerEmail.toLowerCase()) return artist;
  if (await isSuperAdmin(viewerEmail)) return artist;

  return undefined;
}

/** Nullable integer column to an optional number, without turning 0 into
 *  undefined — sort_order 0 is a legitimate first position. */
function optionalInt(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

/** One place each table becomes its type, so the catalogue listings and the
 *  EPK sections can never drift on which columns they read. */
function mapTrack(r: Record<string, unknown>): Track {
  return {
    ...mapMeta(r),
    slug: r.slug as string,
    title: r.title as string,
    artistName: r.artist_name as string,
    artistSlug: (r.artist_slug as string) ?? undefined,
    releasedAt: toISODate(r.released_at as string),
    url: r.url as string,
    coverUrl: (r.cover_url as string) ?? undefined,
    label: (r.label as string) ?? undefined,
    sortOrder: optionalInt(r.sort_order),
  };
}

function mapDjSet(r: Record<string, unknown>): DjSet {
  return {
    ...mapMeta(r),
    slug: r.slug as string,
    title: r.title as string,
    artistName: r.artist_name as string,
    artistSlug: (r.artist_slug as string) ?? undefined,
    duration: r.duration as string,
    recordedAt: toISODate(r.recorded_at as string),
    url: r.url as string,
    coverUrl: (r.cover_url as string) ?? undefined,
    sortOrder: optionalInt(r.sort_order),
  };
}

export async function getAllTracks(opts: ReadOptions = {}): Promise<Track[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM tracks ORDER BY released_at DESC`
    : await sql`SELECT * FROM tracks WHERE status = 'published' AND censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM artists ba JOIN user_profiles u ON lower(u.email) = lower(ba.owner_email) WHERE ba.slug = tracks.artist_slug AND u.banned_at IS NOT NULL) ORDER BY released_at DESC`;
  return rows.map(mapTrack);
}

export async function getAllSets(opts: ReadOptions = {}): Promise<DjSet[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM dj_sets ORDER BY recorded_at DESC`
    : await sql`SELECT * FROM dj_sets WHERE status = 'published' AND censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM artists ba JOIN user_profiles u ON lower(u.email) = lower(ba.owner_email) WHERE ba.slug = dj_sets.artist_slug AND u.banned_at IS NOT NULL) ORDER BY recorded_at DESC`;
  return rows.map(mapDjSet);
}

/**
 * A gig the artist played. Rows sourced from a HOTU lineup carry eventId
 * and the event's own flyer; declared gigs carry externalName and whatever
 * flyer the artist uploaded themselves.
 */
export type ArtistGig = {
  id: number;
  artistSlug: string;
  eventId: number | null;
  eventTitle: string | null;
  externalName: string | null;
  flyerUrl: string | null;
  venue: string | null;
  city: string | null;
  gigDate: string;
  role: string | null;
  b2bWith: string | null;
  durationMinutes: number | null;
  source: "hotu" | "declarado";
};

/**
 * The EPK's DJ SETS section — the real dj_sets rows, not artists.sets.
 *
 * sort_order first, NULLS LAST, then the date. An artist who never
 * reorders anything still gets newest-first; one who drags a favourite to
 * the top gets exactly that, without having to position everything else.
 */
export async function getSetsByArtist(slug: string): Promise<DjSet[]> {
  const rows = await sql`
    SELECT * FROM dj_sets
    WHERE artist_slug = ${slug} AND status = 'published' AND censored_at IS NULL
    ORDER BY sort_order ASC NULLS LAST, recorded_at DESC
  `;
  return rows.map(mapDjSet);
}

/** The EPK's TRACKS section — the real tracks rows, not artists.top_tracks. */
export async function getTracksByArtist(slug: string): Promise<Track[]> {
  const rows = await sql`
    SELECT * FROM tracks
    WHERE artist_slug = ${slug} AND status = 'published' AND censored_at IS NULL
    ORDER BY sort_order ASC NULLS LAST, released_at DESC
  `;
  return rows.map(mapTrack);
}

/**
 * El contenido que se ve en el perfil de un colectivo (§6).
 *
 * DOS ORÍGENES EN UNA SOLA CONSULTA:
 *
 *   VIVO   — la pieza no es fija y la casa ACTUAL de su autor es este
 *            colectivo. No hay ninguna fila guardada que diga eso: se
 *            deriva de artist_collectives cada vez. Por eso cambiar de
 *            casa migra el contenido sin mover una sola fila.
 *   FIJO   — la pieza tiene un placement acá, escrito al publicar o al
 *            aceptar una invitación, y congelado desde entonces.
 *
 * Es un OR de dos EXISTS y no un UNION de dos SELECT, que es lo que
 * decía el plan. Sale mejor por tres razones: una sola pasada sobre la
 * tabla en vez de dos, el ORDER BY no necesita envolver la consulta en
 * una subconsulta, y —la que importa— NO PUEDE DUPLICAR. Un UNION de
 * dos ramas que se solapan deduplica solo si es UNION y no UNION ALL, y
 * ahí la deduplicación depende de acordarse; acá es una propiedad de la
 * forma. Justo el estado prohibido de is_fixed=false CON placement, que
 * el schema no puede impedir, con UNION ALL habría sacado la pieza dos
 * veces y así sale una.
 *
 * La rama viva exige accepted_at IS NOT NULL: una membresía pendiente no
 * es una membresía, y sin eso el contenido de alguien aparecería en un
 * colectivo antes de que el vínculo estuviera aceptado.
 *
 * Una pieza con artist_slug NULL —su artista se borró— no entra por la
 * rama viva, porque no hay a quién preguntarle la casa. Si tenía
 * placement, sigue entrando por la fija.
 *
 * Sirve igual para un venue, y ahí la rama viva nunca matchea: un venue
 * no es la casa de nadie. Solo vería lo fijo, si alguna vez se lo invita
 * como colaborador. Esa decisión está abierta y anotada en PROGRESO.md.
 */
export async function getCollectiveSets(collectiveSlug: string): Promise<DjSet[]> {
  const rows = await sql`
    SELECT * FROM dj_sets s
    WHERE s.status = 'published' AND s.censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM artists ba JOIN user_profiles u ON lower(u.email) = lower(ba.owner_email) WHERE ba.slug = s.artist_slug AND u.banned_at IS NOT NULL) AND (
      (NOT s.is_fixed AND EXISTS (
        SELECT 1 FROM artist_collectives ac
        WHERE ac.artist_slug = s.artist_slug
          AND ac.collective_slug = ${collectiveSlug}
          AND ac.kind = 'casa'
          AND ac.to_date IS NULL
          AND ac.accepted_at IS NOT NULL
      ))
      OR EXISTS (
        SELECT 1 FROM content_placements p
        WHERE p.set_slug = s.slug AND p.collective_slug = ${collectiveSlug}
      )
    )
    ORDER BY s.sort_order ASC NULLS LAST, s.recorded_at DESC
  `;
  return rows.map(mapDjSet);
}

/** Lo mismo para tracks. Misma forma, misma razón. */
export async function getCollectiveTracks(collectiveSlug: string): Promise<Track[]> {
  const rows = await sql`
    SELECT * FROM tracks t
    WHERE t.status = 'published' AND t.censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM artists ba JOIN user_profiles u ON lower(u.email) = lower(ba.owner_email) WHERE ba.slug = t.artist_slug AND u.banned_at IS NOT NULL) AND (
      (NOT t.is_fixed AND EXISTS (
        SELECT 1 FROM artist_collectives ac
        WHERE ac.artist_slug = t.artist_slug
          AND ac.collective_slug = ${collectiveSlug}
          AND ac.kind = 'casa'
          AND ac.to_date IS NULL
          AND ac.accepted_at IS NOT NULL
      ))
      OR EXISTS (
        SELECT 1 FROM content_placements p
        WHERE p.track_slug = t.slug AND p.collective_slug = ${collectiveSlug}
      )
    )
    ORDER BY t.sort_order ASC NULLS LAST, t.released_at DESC
  `;
  return rows.map(mapTrack);
}

/**
 * The EPK's EVENTS carousel. A HOTU gig falls back to the event's own
 * flyer, title, venue and city when the gig row leaves them blank, so a
 * lineup import only has to store the link.
 */
/**
 * Los toques de un artista: los DECLARADOS y los de un evento de HOTU.
 *
 * LOS DOS ORÍGENES SON DISTINTOS A PROPÓSITO (§7):
 *
 *   declarados — artist_gigs. Tocó afuera, no hay evento en la base, y
 *                el DJ lo cargó a mano. Esa tabla sigue siendo la fuente.
 *   de HOTU    — event_lineup. El toque sale del lineup del evento, que
 *                es la relación real. artist_gigs.source='hotu' DEJA DE
 *                LEERSE acá: mismo patrón que los jsonb y district,
 *                primero se deja de leer y la columna queda congelada.
 *
 * Por eso el WHERE de artist_gigs filtra source <> 'hotu'. Sin ese
 * filtro, un toque cargado en las dos tablas saldría dos veces.
 *
 * Un toque de HOTU no tiene duración ni rol propios todavía: event_lineup
 * guarda role y b2b_with, y lo demás sale del evento. Lo que no existe
 * se devuelve null en vez de inventarse.
 */
export async function getGigsByArtist(slug: string): Promise<ArtistGig[]> {
  const rows = await sql`
    SELECT g.*,
           e.title     AS event_title,
           e.flyer_url AS event_flyer_url,
           e.venue     AS event_venue,
           e.city      AS event_city
    FROM artist_gigs g
    LEFT JOIN events e ON e.id = g.event_id
    WHERE g.artist_slug = ${slug} AND g.source <> 'hotu'
    ORDER BY g.gig_date DESC
  `;

  const deLineup = await sql`
    SELECT el.id, el.role, el.b2b_with,
           e.id AS event_id, e.title, e.flyer_url, e.venue, e.city, e.event_date
    FROM event_lineup el
    JOIN events e ON e.id = el.event_id
    WHERE el.artist_slug = ${slug} AND e.status = 'published' AND e.censored_at IS NULL
    ORDER BY e.event_date DESC
  `;
  const declarados: ArtistGig[] = rows.map((r) => ({
    id: r.id,
    artistSlug: r.artist_slug,
    eventId: r.event_id ?? null,
    eventTitle: r.event_title ?? null,
    externalName: r.external_name ?? null,
    flyerUrl: r.flyer_url ?? r.event_flyer_url ?? null,
    venue: r.venue ?? r.event_venue ?? null,
    city: r.city ?? r.event_city ?? null,
    gigDate: toISODate(r.gig_date),
    role: r.role ?? null,
    b2bWith: r.b2b_with ?? null,
    durationMinutes: r.duration_minutes ?? null,
    source: r.source as "hotu" | "declarado",
  }));

  const hotu: ArtistGig[] = deLineup.map((r) => ({
    // id negativo para no chocar con los de artist_gigs: las dos listas
    // se juntan en una sola y React necesita keys únicas. Es un id de
    // presentación, no de base — nadie lo usa para escribir.
    id: -(r.id as number),
    artistSlug: slug,
    eventId: (r.event_id as number) ?? null,
    eventTitle: (r.title as string) ?? null,
    externalName: null,
    flyerUrl: (r.flyer_url as string | null) ?? null,
    venue: (r.venue as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    gigDate: toISODate(r.event_date),
    role: (r.role as string | null) ?? null,
    b2bWith: (r.b2b_with as string | null) ?? null,
    durationMinutes: null,
    source: "hotu" as const,
  }));

  return [...declarados, ...hotu].sort((x, y) => y.gigDate.localeCompare(x.gigDate));
}

/** Una sola conversión de fila a Collective, para que los tres lectores
 *  no puedan divergir en qué columnas leen. */
function mapCollective(r: Record<string, unknown>): Collective {
  return {
    ...mapMeta(r),
    slug: r.slug as string,
    name: r.name as string,
    type: r.type as "HOTU" | "LOCAL",
    sector: r.sector as string,
    bio: r.bio as string,
    entityKind: (r.entity_kind as EntityKind) ?? "collective",
    address: (r.address as string) ?? undefined,
    capacity: r.capacity === null || r.capacity === undefined ? undefined : Number(r.capacity),
  };
}

export async function getAllCollectives(
  opts: ReadOptions & { kind?: EntityKind } = {}
): Promise<Collective[]> {
  // Ordered by name alone. Sector stopped being the grouping axis in tanda
  // 3 (§1.4) — it is a plain city label now, not a heading to sort under.
  const kind = opts.kind ?? "collective";
  const rows = opts.includeAll
    ? await sql`SELECT * FROM collectives WHERE entity_kind = ${kind} ORDER BY name`
    : await sql`SELECT * FROM collectives WHERE entity_kind = ${kind} AND status = 'published' AND censored_at IS NULL ORDER BY name`;
  return rows.map(mapCollective);
}

/** Los venues, que son la misma tabla con otro entity_kind. */
export async function getAllVenues(opts: ReadOptions = {}): Promise<Collective[]> {
  return getAllCollectives({ ...opts, kind: "venue" });
}

/** One active membership, with the artist's display name resolved. */
export type CollectiveMember = {
  collectiveSlug: string;
  artistSlug: string;
  artistName: string;
  kind: "casa" | "residente";
  fromDate: string;
};

/**
 * ACCEPTED memberships for every collective, grouped by collective slug.
 *
 * accepted_at IS NOT NULL is not a detail: a membership only counts with
 * both sides agreeing, so a collective must not be able to list somebody
 * who has not said yes. A pending invitation appears nowhere public.
 *
 * One query for the whole page rather than one per collective, and it
 * joins artists so the caller does not need a second lookup table just to
 * print names.
 *
 * Casa first, then residentes, each alphabetically — a stable order that
 * does not shuffle as rows are added.
 */
export async function getCollectiveMembers(
  kind: EntityKind = "collective"
): Promise<Map<string, CollectiveMember[]>> {
  // El JOIN contra collectives es lo que separa los dos rosters. Sin él,
  // los residentes de un venue saldrían listados bajo el venue en
  // /colectivos, que es la mezcla que §5 dice que no se negocia.
  const rows = await sql`
    SELECT ac.collective_slug, ac.artist_slug, ac.kind, ac.from_date, a.name AS artist_name
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
      AND c.entity_kind = ${kind}
    ORDER BY ac.collective_slug,
             CASE ac.kind WHEN 'casa' THEN 0 ELSE 1 END,
             a.name
  `;
  const byCollective = new Map<string, CollectiveMember[]>();
  for (const r of rows) {
    const slug = r.collective_slug as string;
    if (!byCollective.has(slug)) byCollective.set(slug, []);
    byCollective.get(slug)!.push({
      collectiveSlug: slug,
      artistSlug: r.artist_slug as string,
      artistName: r.artist_name as string,
      kind: r.kind as "casa" | "residente",
      fromDate: toISODate(r.from_date as string),
    });
  }
  return byCollective;
}

/*
 * getCollectivesBySector was removed in tanda 3 (§1.4). It had no callers
 * left once /colectivos stopped grouping by sector, and a dead grouping
 * helper is an invitation to group by it again.
 */

/**
 * El colectivo con ese slug, o undefined.
 *
 * Filtra por tipo, así que /colectivos/<slug-de-venue> devuelve undefined
 * y la página hace notFound(), en vez de renderizar un venue con el press
 * kit de un colectivo. Los slugs son únicos en toda la tabla, así que no
 * hay ambigüedad: el filtro decide si ESTA sección lo muestra, no cuál de
 * dos filas es.
 */
export async function getCollectiveBySlug(
  slug: string,
  kind: EntityKind = "collective",
  /**
   * Quién está mirando. Con esto, el DUEÑO ve su colectivo censurado en
   * vez de recibir un 404 igual que un desconocido.
   *
   * Es el mismo patrón que getArtistBySlug, y faltaba: PanelModeracion
   * promete "su autor la sigue viendo, marcada y con el motivo", y para
   * un colectivo eso era falso. La dueña de uno bajado no tenía forma de
   * enterarse salvo visitando su propia página y encontrando un 404 sin
   * explicación.
   */
  viewerEmail?: string | null
): Promise<Collective | undefined> {
  const rows = await sql`
    SELECT * FROM collectives
    WHERE slug = ${slug} AND status = 'published' AND entity_kind = ${kind}
  `;
  if (rows.length === 0) return undefined;
  const c = mapCollective(rows[0]);
  if (!c.censoredAt) return c;

  // Censurado: solo su dueño y un moderador. Para el resto no existe.
  if (!viewerEmail) return undefined;
  const owner = (rows[0].owner_email as string | null) ?? null;
  if (owner && owner.toLowerCase() === viewerEmail.toLowerCase()) return c;
  if (await isModerator(viewerEmail)) return c;
  return undefined;
}

export async function getVenueBySlug(
  slug: string,
  viewerEmail?: string | null
): Promise<Collective | undefined> {
  return getCollectiveBySlug(slug, "venue", viewerEmail);
}

/** The artist profile this account speaks for, if it has one. */
/**
 * ¿El dueño de este artista está baneado?
 *
 * Se pregunta aparte y no con un JOIN en el SELECT porque
 * getArtistBySlug devuelve la fila cruda mapeada, y agregarle una
 * columna calculada obligaría a tocar el tipo Artist para un dato que
 * solo importa en la decisión de servir o no.
 */
async function duenoBaneado(slug: string): Promise<boolean> {
  const filas = await sql`
    SELECT 1 FROM artists a
    JOIN user_profiles u ON lower(u.email) = lower(a.owner_email)
    WHERE a.slug = ${slug} AND u.banned_at IS NOT NULL
  `;
  return filas.length > 0;
}

export async function getMyArtistSlug(email: string): Promise<string | null> {
  const rows = await sql`
    SELECT slug FROM artists WHERE lower(owner_email) = lower(${email}) LIMIT 1
  `;
  return (rows[0]?.slug as string) ?? null;
}

/**
 * Collectives this account owns.
 *
 * §4.2: the owner administers without switching accounts, from their own
 * profile. That is what this feeds — the collective's inbox does not live
 * behind /admin, which only a SUPER_ADMIN can reach.
 */
export async function getCollectivesOwnedBy(
  email: string,
  kind: EntityKind = "collective"
): Promise<Collective[]> {
  const rows = await sql`
    SELECT * FROM collectives
    WHERE lower(owner_email) = lower(${email}) AND entity_kind = ${kind}
    ORDER BY name
  `;
  return rows.map(mapCollective);
}

/** One side of an open membership conversation. */
export type PendingMembership = {
  id: number;
  artistSlug: string;
  artistName: string;
  collectiveSlug: string;
  collectiveName: string;
  /** Who opened it — decides whether this reads as an invitation or an
   *  application, and therefore who is expected to answer. */
  requestedBy: "artist" | "collective";
  createdAt: string;
};

function mapPending(r: Record<string, unknown>): PendingMembership {
  return {
    id: Number(r.id),
    artistSlug: r.artist_slug as string,
    artistName: r.artist_name as string,
    collectiveSlug: r.collective_slug as string,
    collectiveName: r.collective_name as string,
    requestedBy: r.requested_by as "artist" | "collective",
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

/** Everything waiting on this account as a DJ: invitations to answer, plus
 *  their own applications still unanswered. */
export async function getPendingForArtist(email: string): Promise<PendingMembership[]> {
  const rows = await sql`
    SELECT ac.id, ac.artist_slug, ac.collective_slug, ac.requested_by, ac.created_at,
           a.name AS artist_name, c.name AS collective_name
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.accepted_at IS NULL AND ac.rejected_at IS NULL AND ac.to_date IS NULL
      AND lower(a.owner_email) = lower(${email})
    ORDER BY ac.created_at DESC
  `;
  return rows.map(mapPending);
}

/** Everything waiting on one collective: applications to answer, plus its
 *  own invitations still unanswered. */
export async function getPendingForCollective(
  collectiveSlug: string
): Promise<PendingMembership[]> {
  const rows = await sql`
    SELECT ac.id, ac.artist_slug, ac.collective_slug, ac.requested_by, ac.created_at,
           a.name AS artist_name, c.name AS collective_name
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.accepted_at IS NULL AND ac.rejected_at IS NULL AND ac.to_date IS NULL
      AND ac.collective_slug = ${collectiveSlug}
    ORDER BY ac.created_at DESC
  `;
  return rows.map(mapPending);
}

/** An accepted, live membership seen from the DJ's side. */
export type MyMembership = {
  id: number;
  collectiveSlug: string;
  collectiveName: string;
  kind: "casa" | "residente";
  fromDate: string;
  /**
   * Colectivo o venue. Acá NO se filtra por tipo, a diferencia de los
   * listados públicos: el DJ tiene que ver todos sus vínculos juntos,
   * porque son suyos. Lo que cambia es la etiqueta, y sobre todo que en
   * un venue no se le ofrece "hacer mi casa": un venue no es la casa de
   * nadie.
   */
  entityKind: EntityKind;
};

/**
 * The collectives this account actually belongs to.
 *
 * Needed as its own read, not folded into the pending list: once the other
 * side accepts, the row stops being pending but the DJ may still have to
 * choose whether it is their casa — the spec puts that choice after the
 * acceptance. Without this the choice would have nowhere to happen.
 */
export async function getMyMemberships(email: string): Promise<MyMembership[]> {
  const rows = await sql`
    SELECT ac.id, ac.collective_slug, ac.kind, ac.from_date,
           c.name AS collective_name, c.entity_kind
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
      AND lower(a.owner_email) = lower(${email})
    ORDER BY CASE ac.kind WHEN 'casa' THEN 0 ELSE 1 END, c.entity_kind, c.name
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    collectiveSlug: r.collective_slug as string,
    collectiveName: r.collective_name as string,
    kind: r.kind as "casa" | "residente",
    fromDate: toISODate(r.from_date as string),
    entityKind: (r.entity_kind as EntityKind) ?? "collective",
  }));
}

/**
 * The collective that is currently this account's home, if any.
 *
 * Used to name it when offering to replace it, so the warning reads "hoy
 * tu casa es X" instead of something abstract the DJ has to go look up.
 */
export async function getMyCurrentCasa(
  email: string
): Promise<{ slug: string; name: string } | null> {
  // SIN filtro por entity_kind, a propósito. Una casa solo puede estar en
  // un colectivo, y eso lo garantiza el write path. Filtrar acá por
  // entity_kind = 'collective' ESCONDERÍA una casa que se hubiera colado
  // en un venue en vez de mostrarla: el DJ vería "no tenés casa" teniendo
  // una, y el diálogo de conflicto no se abriría nunca. Si alguna vez
  // aparece una casa en un venue, es un bug del write path y tiene que
  // verse, no taparse desde la lectura.
  const rows = await sql`
    SELECT c.slug, c.name
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.kind = 'casa' AND ac.to_date IS NULL AND ac.accepted_at IS NOT NULL
      AND lower(a.owner_email) = lower(${email})
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return { slug: rows[0].slug as string, name: rows[0].name as string };
}

/**
 * Memberships this collective LOST — closed links, newest first.
 *
 * §3.2 says the owner always finds out when they lose somebody. This is
 * that notification, read out of the history rather than pushed anywhere:
 * the rows are already immutable, so the panel only has to show them.
 */
export async function getRecentDepartures(
  collectiveSlug: string,
  limit = 10
): Promise<{ artistSlug: string; artistName: string; kind: string; toDate: string }[]> {
  const rows = await sql`
    SELECT ac.artist_slug, ac.kind, ac.to_date, a.name AS artist_name
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    WHERE ac.collective_slug = ${collectiveSlug}
      AND ac.to_date IS NOT NULL
      AND ac.accepted_at IS NOT NULL
    ORDER BY ac.to_date DESC, ac.id DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    artistSlug: r.artist_slug as string,
    artistName: r.artist_name as string,
    kind: r.kind as string,
    toDate: toISODate(r.to_date as string),
  }));
}

export type LikedArtist = {
  slug: string;
  name: string;
  photo: string | null;
  likedAt: string;
};

/**
 * The artists this account has liked, newest first.
 *
 * Only published artists come back. A like is a private bookmark, but the
 * card it renders links to a public page, and an archived or draft artist
 * would hand the user a dead link.
 *
 * The like itself is never a ranking signal — it exists so the user can be
 * told when that DJ plays, and so the DJ can see how many people follow
 * their work. Nothing here feeds ordering or exposure anywhere else.
 */
export async function getLikedArtists(email: string): Promise<LikedArtist[]> {
  const rows = await sql`
    SELECT a.slug, a.name, a.photo, al.created_at
    FROM artist_likes al
    JOIN artists a ON a.slug = al.artist_slug
    WHERE al.user_email = ${email}
      AND a.status = 'published' AND a.censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_profiles u WHERE lower(u.email) = lower(a.owner_email) AND u.banned_at IS NOT NULL)
    ORDER BY al.created_at DESC
  `;
  return rows.map((r) => ({
    slug: r.slug as string,
    name: r.name as string,
    photo: (r.photo as string | null) ?? null,
    likedAt: String(r.created_at),
  }));
}

/** Whether this account has liked this artist — drives the button's state. */
export async function hasLikedArtist(email: string, artistSlug: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM artist_likes
    WHERE user_email = ${email} AND artist_slug = ${artistSlug}
  `;
  return rows.length > 0;
}

/** How many people follow this artist. Public: the DJ's own audience count. */
export async function countArtistLikes(artistSlug: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM artist_likes WHERE artist_slug = ${artistSlug}
  `;
  return (rows[0]?.n as number) ?? 0;
}

/**
 * Los colectivos —o los venues— que esta cuenta marcó, del más nuevo al
 * más viejo (§11).
 *
 * Los venues salen gratis de compartir tabla con los colectivos: es la
 * misma consulta con otro entity_kind. Se piden por separado a propósito
 * y no en una sola lista mezclada, porque para el usuario son dos cosas
 * distintas y §5 dice que eso no se negocia — /venues y /colectivos son
 * secciones separadas, y en su perfil también.
 *
 * Solo publicados, por lo mismo que los artistas: el like es un marcador
 * privado pero la tarjeta linkea a una página pública, y un colectivo
 * archivado le daría al usuario un link muerto.
 *
 * collectives NO tiene columna de foto, así que photo sale null siempre
 * y la tarjeta cae en el placeholder. Es correcto, no es un pendiente: el
 * día que haya foto de colectivo, esta consulta la suma y la tarjeta ya
 * sabe qué hacer con ella.
 */
export async function getLikedCollectives(
  email: string,
  kind: EntityKind = "collective"
): Promise<LikedArtist[]> {
  const rows = await sql`
    SELECT c.slug, c.name, cl.created_at
    FROM collective_likes cl
    JOIN collectives c ON c.slug = cl.collective_slug
    WHERE cl.user_email = ${email}
      AND c.status = 'published' AND c.censored_at IS NULL
      AND c.entity_kind = ${kind}
    ORDER BY cl.created_at DESC
  `;
  return rows.map((r) => ({
    slug: r.slug as string,
    name: r.name as string,
    photo: null,
    likedAt: String(r.created_at),
  }));
}

/**
 * Si esta cuenta ya marcó este colectivo. Maneja el estado del botón.
 *
 * SIN filtrar por entity_kind, a propósito: la pregunta es sobre una fila
 * concreta que el llamador ya tiene en la mano, y filtrar acá haría que
 * el botón de un venue se dibujara siempre vacío aunque el like exista.
 */
export async function hasLikedCollective(email: string, collectiveSlug: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM collective_likes
    WHERE user_email = ${email} AND collective_slug = ${collectiveSlug}
  `;
  return rows.length > 0;
}

/** Cuánta gente sigue este colectivo o venue. Público, igual que el de artista. */
export async function countCollectiveLikes(collectiveSlug: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM collective_likes WHERE collective_slug = ${collectiveSlug}
  `;
  return (rows[0]?.n as number) ?? 0;
}

export type CandidatoColab = { slug: string; name: string; kind: "artist" | "collective" };

/**
 * A quién se puede invitar a colaborar (§6.1): artistas y colectivos
 * publicados.
 *
 * SIN VENUES. Un venue no colabora en una pieza: la música es de quien
 * la hace, no del lugar donde suena. El write path lo rechaza igual —es
 * la frontera de verdad, porque la app móvil va a usar el mismo
 * endpoint—, pero ofrecer en un selector algo que el servidor va a
 * rechazar es hacerle perder el tiempo a la persona.
 *
 * Se cargan enteros y se filtran en el cliente: son decenas, no miles, y
 * ir al servidor por cada letra tecleada sería peor por todos lados.
 */
export async function getCandidatosColab(): Promise<CandidatoColab[]> {
  const artistas = await sql`
    SELECT slug, name FROM artists WHERE status = 'published' AND censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_profiles u WHERE lower(u.email) = lower(artists.owner_email) AND u.banned_at IS NOT NULL) ORDER BY name
  `;
  const colectivos = await sql`
    SELECT slug, name FROM collectives
    WHERE status = 'published' AND censored_at IS NULL AND entity_kind = 'collective' ORDER BY name
  `;
  return [
    ...artistas.map((r) => ({
      slug: r.slug as string,
      name: r.name as string,
      kind: "artist" as const,
    })),
    ...colectivos.map((r) => ({
      slug: r.slug as string,
      name: r.name as string,
      kind: "collective" as const,
    })),
  ];
}

export type InvitacionColab = {
  id: number;
  tipo: "set" | "track";
  piezaSlug: string;
  piezaTitulo: string;
  autorNombre: string;
  autorSlug: string | null;
  invitadaEn: string;
  /** Adónde va a quedar fija si acepta: su casa de HOY, o null. */
  destino: string | null;
  /** El nombre del colectivo invitado, cuando la invitación es a uno. */
  colectivoNombre: string | null;
};

/**
 * Las invitaciones a colaborar PENDIENTES de esta cuenta (§6.1).
 *
 * Pendiente = ni aceptada ni rechazada. Las rechazadas se conservan —el
 * histórico es inmutable— pero no vuelven a la bandeja.
 *
 * DIRIGIDA A UN ARTISTA O A UN COLECTIVO, y el llamador elige cuál
 * quiere. La distinción es A QUIÉN ESTÁ DIRIGIDA, no quién la recibe:
 * las dos le llegan a la misma cuenta por owner_email, pero el dueño de
 * un colectivo va a buscar la suya donde administra y no donde está su
 * press kit. Por eso el panel ARTISTA pide las de artista y el panel
 * COLECTIVO las de colectivo.
 *
 * Una cuenta que es las dos cosas ve cada una en su lugar: la que la
 * invitó a ella como DJ en ARTISTA, la que invitó a su crew en
 * COLECTIVO.
 *
 * El destino se calcula AL LEER y no al invitar, a propósito: es dónde
 * va a quedar la pieza si acepta HOY, y la casa puede cambiar entre la
 * invitación y la respuesta. Mostrar el de la invitación sería prometer
 * un destino viejo.
 */
export async function getInvitacionesColab(
  email: string,
  dirigidaA: "artist" | "collective" = "artist"
): Promise<InvitacionColab[]> {
  const esArtista = dirigidaA === "artist";
  const rows = await sql`
    SELECT cc.id, cc.set_slug, cc.track_slug, cc.invited_at, c.name AS colectivo_nombre,
           COALESCE(s.title, t.title) AS titulo,
           COALESCE(s.artist_name, t.artist_name) AS autor_nombre,
           COALESCE(s.artist_slug, t.artist_slug) AS autor_slug,
           COALESCE(
             (SELECT ac.collective_slug FROM artist_collectives ac
              WHERE ac.artist_slug = cc.artist_slug AND ac.kind = 'casa'
                AND ac.to_date IS NULL AND ac.accepted_at IS NOT NULL LIMIT 1),
             cc.collective_slug
           ) AS destino
    FROM content_collaborators cc
    LEFT JOIN artists a ON a.slug = cc.artist_slug
    LEFT JOIN collectives c ON c.slug = cc.collective_slug
    LEFT JOIN dj_sets s ON s.slug = cc.set_slug
    LEFT JOIN tracks t ON t.slug = cc.track_slug
    WHERE cc.accepted_at IS NULL AND cc.declined_at IS NULL
      AND CASE WHEN ${esArtista}
        THEN cc.artist_slug IS NOT NULL AND lower(a.owner_email) = lower(${email})
        ELSE cc.collective_slug IS NOT NULL AND lower(c.owner_email) = lower(${email})
      END
    ORDER BY cc.invited_at DESC
  `;
  return rows.map((r) => ({
    id: r.id as number,
    tipo: r.set_slug ? ("set" as const) : ("track" as const),
    piezaSlug: (r.set_slug ?? r.track_slug) as string,
    piezaTitulo: (r.titulo as string) ?? "",
    autorNombre: (r.autor_nombre as string) ?? "",
    autorSlug: (r.autor_slug as string | null) ?? null,
    invitadaEn: String(r.invited_at),
    destino: (r.destino as string | null) ?? null,
    colectivoNombre: (r.colectivo_nombre as string | null) ?? null,
  }));
}

export type EnRevision = {
  slug: string;
  name: string;
  photo: string | null;
  bio: string;
  city: string;
  origin: string | null;
  djCode: string | null;
  ownerEmail: string | null;
  submittedAt: string | null;
  /** Días enteros que lleva esperando. Lo calcula la base, que es la que
   *  sabe qué hora es, y no el navegador de quien mira. */
  diasEnCola: number | null;
  branchPrimario: string | null;
  branchesSecundarios: string[];
  tags: string[];
  sets: number;
  tracks: number;
  /** Si ya fue rechazado antes, el motivo de aquella vez. Sirve para ver
   *  de un vistazo si corrigió lo que se le pidió. */
  rechazoAnterior: string | null;
};

/**
 * La cola de aprobación de /admin/artistas.
 *
 * Trae TODO lo que hace falta para decidir sin abrir el perfil: foto,
 * bio, género, ciudad, cuántos sets y tracks tiene, y cuánto lleva
 * esperando. Si hubiera que abrir cada uno, la cola se acumula y la
 * aprobación deja de pasar, que es el modo de fallar de este diseño.
 *
 * Ordenada por antigüedad, lo más viejo primero: una cola donde lo nuevo
 * va arriba es una cola donde lo viejo no se revisa nunca.
 */
export async function getArtistsInReview(): Promise<EnRevision[]> {
  const rows = await sql`
    SELECT a.slug, a.name, a.photo, a.bio, a.city, a.origin, a.dj_code, a.owner_email,
           a.submitted_at, a.review_note,
           EXTRACT(DAY FROM (now() - a.submitted_at))::int AS dias,
           (SELECT COUNT(*)::int FROM dj_sets WHERE artist_slug = a.slug) AS sets,
           (SELECT COUNT(*)::int FROM tracks  WHERE artist_slug = a.slug) AS tracks,
           (SELECT b.name FROM artist_genres ag
              JOIN genre_branches b ON b.code = ag.branch_code
             WHERE ag.artist_slug = a.slug AND ag.is_primary LIMIT 1) AS branch_primario,
           COALESCE((SELECT array_agg(b.name ORDER BY ag.sort_order) FROM artist_genres ag
              JOIN genre_branches b ON b.code = ag.branch_code
             WHERE ag.artist_slug = a.slug AND NOT ag.is_primary), '{}') AS secundarios,
           COALESCE((SELECT array_agg(t.name ORDER BY agt.sort_order) FROM artist_genre_tags agt
              JOIN genre_tags t ON t.slug = agt.tag_slug AND t.branch_code = agt.branch_code
             WHERE agt.artist_slug = a.slug), '{}') AS tags
    FROM artists a
    WHERE a.review_status = 'en_revision'
    ORDER BY a.submitted_at ASC NULLS LAST
  `;
  return rows.map((r) => ({
    slug: r.slug as string,
    name: r.name as string,
    photo: (r.photo as string | null) ?? null,
    bio: (r.bio as string) ?? "",
    city: (r.city as string) ?? "",
    origin: (r.origin as string | null) ?? null,
    djCode: (r.dj_code as string | null) ?? null,
    ownerEmail: (r.owner_email as string | null) ?? null,
    submittedAt: r.submitted_at ? String(r.submitted_at) : null,
    diasEnCola: r.dias === null || r.dias === undefined ? null : Number(r.dias),
    branchPrimario: (r.branch_primario as string | null) ?? null,
    branchesSecundarios: (r.secundarios as string[]) ?? [],
    tags: (r.tags as string[]) ?? [],
    sets: Number(r.sets ?? 0),
    tracks: Number(r.tracks ?? 0),
    rechazoAnterior: (r.review_note as string | null) ?? null,
  }));
}

export type GenreOfProfile = {
  /** null cuando el perfil todavía no declaró género. */
  primary: { code: string; name: string } | null;
  secondary: { code: string; name: string }[];
  tags: { slug: string; name: string; branchCode: string }[];
};

/**
 * El género declarado por un perfil, artista o colectivo.
 *
 * Devuelve `primary: null` cuando no hay ninguno, que es el estado de
 * los 12 artistas y 6 colectivos que existían antes de la taxonomía. Ese
 * estado no es un error: nadie les inventó un género, y el perfil le
 * pide al dueño que lo complete, igual que con cualquier otra sección
 * vacía.
 */
export async function getProfileGenres(
  owner: "artist" | "collective",
  slug: string
): Promise<GenreOfProfile> {
  const esArtista = owner === "artist";
  const ramas = esArtista
    ? await sql`
        SELECT ag.branch_code, ag.is_primary, b.name
        FROM artist_genres ag JOIN genre_branches b ON b.code = ag.branch_code
        WHERE ag.artist_slug = ${slug} ORDER BY ag.sort_order
      `
    : await sql`
        SELECT cg.branch_code, cg.is_primary, b.name
        FROM collective_genres cg JOIN genre_branches b ON b.code = cg.branch_code
        WHERE cg.collective_slug = ${slug} ORDER BY cg.sort_order
      `;

  const tags = esArtista
    ? await sql`
        SELECT agt.tag_slug, agt.branch_code, t.name
        FROM artist_genre_tags agt
        JOIN genre_tags t ON t.slug = agt.tag_slug AND t.branch_code = agt.branch_code
        WHERE agt.artist_slug = ${slug} ORDER BY agt.sort_order
      `
    : await sql`
        SELECT cgt.tag_slug, cgt.branch_code, t.name
        FROM collective_genre_tags cgt
        JOIN genre_tags t ON t.slug = cgt.tag_slug AND t.branch_code = cgt.branch_code
        WHERE cgt.collective_slug = ${slug} ORDER BY cgt.sort_order
      `;

  const prim = ramas.find((r) => r.is_primary);
  return {
    primary: prim ? { code: prim.branch_code as string, name: prim.name as string } : null,
    secondary: ramas
      .filter((r) => !r.is_primary)
      .map((r) => ({ code: r.branch_code as string, name: r.name as string })),
    tags: tags.map((r) => ({
      slug: r.tag_slug as string,
      name: r.name as string,
      branchCode: r.branch_code as string,
    })),
  };
}

/** Lo que un listado necesita saber del género de cada fila: sus ramas
 *  —la primaria aparte de las secundarias— y sus tags, por slug. */
export type GenreIndexEntry = {
  /** La rama primaria, o null si el perfil no declaró género. */
  branch: string | null;
  /** Las secundarias, hasta tres. Sin la primaria adentro. */
  secondary: string[];
  tags: string[];
};

/**
 * El género de TODOS los perfiles de un tipo, indexado por slug.
 *
 * LAS SECUNDARIAS CUENTAN PARA EL FILTRO, y se devuelven aparte de la
 * primaria porque el orden las distingue.
 *
 * Un perfil que declara TECHNO primaria y ACID secundaria IMPRIME las
 * dos en su press kit, así que tiene que aparecer al filtrar por las
 * dos: mostrar ACID y no salir en ACID es mentirle a quien buscó. Que un
 * perfil viva en hasta cuatro ramas es ambiguo, pero es lo que el
 * documento de géneros describe — un DJ de techno que toca acid existe
 * en las dos—, y la ambigüedad es más barata que la mentira.
 *
 * Lo que sostiene que elegir una rama siga significando algo es el
 * ORDEN, no la exclusión: el listado pone primero a los que la tienen
 * como primaria. Eso lo hace useFilteredList, y por eso necesita las dos
 * listas separadas y no una sola con las cuatro mezcladas.
 *
 * Los listados filtran en el cliente —el buscador ya funciona así— y
 * para eso necesitan el género de cada fila junto con la fila. Dos
 * consultas para toda la página, no una por artista.
 *
 * Un perfil sin género queda con branch null y tags vacíos, y el filtro
 * lo deja afuera en cuanto alguien elige una rama. Es correcto: no
 * declaró género, así que no pertenece a ninguno.
 */
export async function getGenreIndex(
  owner: "artist" | "collective"
): Promise<Record<string, GenreIndexEntry>> {
  // Sin WHERE is_primary: hacen falta las cuatro. is_primary viene en la
  // fila para poder separarlas, que es lo que el orden del listado usa.
  const ramas =
    owner === "artist"
      ? await sql`SELECT artist_slug AS slug, branch_code, is_primary FROM artist_genres`
      : await sql`SELECT collective_slug AS slug, branch_code, is_primary FROM collective_genres`;
  const tags =
    owner === "artist"
      ? await sql`SELECT artist_slug AS slug, tag_slug FROM artist_genre_tags`
      : await sql`SELECT collective_slug AS slug, tag_slug FROM collective_genre_tags`;

  const out: Record<string, GenreIndexEntry> = {};
  const vacio = (): GenreIndexEntry => ({ branch: null, secondary: [], tags: [] });
  for (const r of ramas) {
    const slug = r.slug as string;
    if (!out[slug]) out[slug] = vacio();
    if (r.is_primary) out[slug].branch = r.branch_code as string;
    else out[slug].secondary.push(r.branch_code as string);
  }
  for (const t of tags) {
    const slug = t.slug as string;
    if (!out[slug]) out[slug] = vacio();
    out[slug].tags.push(t.tag_slug as string);
  }
  return out;
}

/**
 * El mismo índice, recortado a los slugs que de verdad salen en una
 * página.
 *
 * Hace falta porque el índice trae TODOS los perfiles y una página
 * muestra menos: /artistas esconde los borradores, y /sets y
 * /discografia se cuelgan del género del artista asociado, que es un
 * puñado de los que existen. Sin recortar, getFilterOptions ofrecería
 * ramas que no devuelven ninguna fila.
 *
 * Los slugs nulos —un set cuyo artista se borró— se ignoran: la fila
 * sigue saliendo bajo el nombre del artista, pero sin género, así que
 * no aporta opciones ni sobrevive a elegir una rama.
 */
export function pickGenreIndex(
  indice: Record<string, GenreIndexEntry>,
  slugs: (string | null | undefined)[]
): Record<string, GenreIndexEntry> {
  const out: Record<string, GenreIndexEntry> = {};
  for (const s of slugs) {
    if (!s) continue;
    const g = indice[s];
    if (g) out[s] = g;
  }
  return out;
}

/**
 * Las opciones de los dos filtros de una página, armadas con lo que de
 * verdad aparece en ella.
 *
 * Misma regla que el filtro 2 desde el HOTFIX: un filtro no puede
 * ofrecer una opción que no devuelva nada. Con 34 ramas y 719 tags eso
 * importa más que antes — un desplegable de 719 entradas donde 700 no
 * matchean nada es peor que no tener filtro.
 */
export async function getFilterOptions(
  indice: Record<string, GenreIndexEntry>
): Promise<{ branches: BranchOption[]; tags: { slug: string; name: string }[] }> {
  // Las secundarias también se ofrecen: ahora devuelven filas, así que
  // esconderlas del desplegable dejaría un género inalcanzable.
  const usadas = [
    ...new Set(Object.values(indice).flatMap((g) => [g.branch, ...g.secondary]).filter(Boolean)),
  ] as string[];
  const usadosTags = [...new Set(Object.values(indice).flatMap((g) => g.tags))];
  if (usadas.length === 0 && usadosTags.length === 0) return { branches: [], tags: [] };

  const branches = usadas.length
    ? await sql`
        SELECT code, name, category FROM genre_branches
        WHERE code = ANY(${usadas}::text[]) ORDER BY sort_order, code
      `
    : [];
  // Una fila POR SLUG, no por par (slug, name). Acá el tag es una
  // etiqueta y no un par: filtrar por "acid-techno" tiene que traer a
  // quien lo tomó desde ACID y a quien lo tomó desde TEC, así que el
  // desplegable lo lista una sola vez.
  //
  // DISTINCT a secas no alcanzaba: deduplica el par, y hay slugs cuyo
  // nombre cambia según la rama —afro-funk es "Afro Funk" en una y
  // "Afro-Funk" en otra, dance-pop es "Dance / Pop" y "Dance Pop"—, así
  // que salían dos <option> con la misma key de React y dos entradas
  // distintas en pantalla que filtraban exactamente lo mismo.
  //
  // DISTINCT ON exige que el ORDER BY empiece por su misma expresión,
  // por eso ordena por (slug, name) y el alfabético para la pantalla se
  // aplica después, ya con una fila por slug.
  const tags = usadosTags.length
    ? await sql`
        SELECT DISTINCT ON (slug) slug, name FROM genre_tags
        WHERE slug = ANY(${usadosTags}::text[]) ORDER BY slug, name
      `
    : [];

  return {
    branches: branches.map((r) => ({
      code: r.code as string,
      name: r.name as string,
      category: r.category as string,
    })),
    tags: tags
      .map((r) => ({ slug: r.slug as string, name: r.name as string }))
      .sort((x, y) => x.name.localeCompare(y.name, "es")),
  };
}

/**
 * Las ramas que TIENEN artistas, con cuántos, de más a menos.
 *
 * Es lo que reemplaza a la grilla de los diez distritos en la home. La
 * diferencia no es cosmética: los distritos eran diez fijos y siempre
 * estaban los diez, tuvieran algo detrás o no. Acá una rama aparece
 * solo si alguien la declaró, y el orden lo decide la cantidad.
 *
 * SI NO HAY NINGUNA, DEVUELVE UNA LISTA VACÍA Y EL BLOQUE NO SE
 * RENDERIZA. Misma regla que el resto del sitio —las secciones vacías no
 * se muestran— y es el estado real de producción hoy: la taxonomía está
 * sembrada pero ningún artista declaró género todavía, así que la home
 * va a quedar sin ese bloque hasta que el primero lo haga.
 *
 * Cuenta primarias Y secundarias, igual que el filtro: si el listado te
 * va a mostrar a quien declaró ACID de secundaria, la home tiene que
 * contarlo, o el número de la baldosa no coincide con lo que se ve al
 * entrar. DISTINCT sobre el artista para que declarar la misma rama dos
 * veces no lo cuente dos veces.
 *
 * Solo artistas publicados: un borrador no es contenido que el visitante
 * pueda ver, y una baldosa que promete 3 y muestra 1 es peor que no
 * estar.
 */
export async function getBranchesWithContent(): Promise<
  { code: string; name: string; count: number }[]
> {
  const rows = await sql`
    SELECT b.code, b.name, COUNT(DISTINCT g.artist_slug)::int AS n
    FROM artist_genres g
    JOIN genre_branches b ON b.code = g.branch_code
    JOIN artists a ON a.slug = g.artist_slug AND a.status = 'published' AND a.censored_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_profiles u WHERE lower(u.email) = lower(a.owner_email) AND u.banned_at IS NOT NULL)
    GROUP BY b.code, b.name
    ORDER BY n DESC, b.name
  `;
  return rows.map((r) => ({
    code: r.code as string,
    name: r.name as string,
    count: r.n as number,
  }));
}

export type BranchOption = { code: string; name: string; category: string };
export type TagOption = { slug: string; name: string; branchCode: string };

/** Los 34 branches, en el orden del documento. */
export async function getGenreBranches(): Promise<BranchOption[]> {
  const rows = await sql`
    SELECT code, name, category FROM genre_branches ORDER BY sort_order, code
  `;
  return rows.map((r) => ({
    code: r.code as string,
    name: r.name as string,
    category: r.category as string,
  }));
}

/**
 * TODOS los tags, los 719, de una sola vez.
 *
 * Se cargan enteros a propósito. El selector NO puede quedar encerrado
 * en la rama elegida: 71 slugs viven en más de un branch y electro-house
 * vive en tres, así que un DJ de TECHNO tiene que poder tomar
 * acid-techno desde ACID. Con todo en memoria, esa búsqueda cruzada es
 * instantánea; pidiéndolos por rama habría que ir al servidor cada vez
 * que alguien escribe una letra, y el caso interesante —buscar fuera de
 * tu propia rama— sería el más lento.
 *
 * Son unos 36KB. Menos que una foto de perfil.
 */
export async function getGenreTags(): Promise<TagOption[]> {
  const rows = await sql`
    SELECT slug, name, branch_code FROM genre_tags ORDER BY branch_code, sort_order, name
  `;
  return rows.map((r) => ({
    slug: r.slug as string,
    name: r.name as string,
    branchCode: r.branch_code as string,
  }));
}

export async function getAllEvents(opts: ReadOptions = {}): Promise<EventItem[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM events ORDER BY event_date ASC`
    : await sql`SELECT * FROM events WHERE status = 'published' AND censored_at IS NULL ORDER BY event_date ASC`;
  return rows.map((r) => ({
    ...mapMeta(r),
    id: r.id,
    date: toISODate(r.event_date),
    endAt: r.end_at ? new Date(r.end_at as string).toISOString() : null,
    flyerUrl: (r.flyer_url as string | null) ?? null,
    city: r.city,
    venue: r.venue,
    title: r.title,
    lineup: r.lineup,
    organizerSlug: (r.organizer_slug as string | null) ?? null,
    lineupReviewedAt: r.lineup_reviewed_at
      ? new Date(r.lineup_reviewed_at as string).toISOString()
      : null,
  }));
}

export async function getAllNews(opts: ReadOptions = {}): Promise<NewsItem[]> {
  const rows = opts.includeAll
    ? await sql`SELECT * FROM news ORDER BY news_date DESC`
    : await sql`SELECT * FROM news WHERE status = 'published' AND censored_at IS NULL ORDER BY news_date DESC`;
  return rows.map((r) => ({
    ...mapMeta(r),
    id: r.id,
    tag: r.tag,
    date: toISODate(r.news_date),
    title: r.title,
    excerpt: r.excerpt,
  }));
}

/* ===================================================================
 * NOTICIAS DE LA COMUNIDAD (tanda 5 §3)
 * =================================================================== */

/**
 * Una noticia propia, con su estado en la cola.
 *
 * Es la bandeja del autor: incluye lo que NO es público, que es
 * justamente lo que el autor necesita ver. reviewNote es la notificación
 * del rechazo — no hay un sistema de avisos aparte, el motivo se lee
 * donde está la noticia, igual que en el press kit del DJ.
 */
export type MiNoticia = {
  id: number;
  tag: string;
  date: string;
  title: string;
  excerpt: string;
  /** El colectivo o venue que la firma. */
  authorSlug: string;
  authorName: string;
  reviewStatus: "borrador" | "en_revision" | "rechazado" | "aprobado";
  /** El motivo del rechazo, si la rechazaron. */
  reviewNote: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  /** Si está en el sitio. Solo la aprobación lo pone en true. */
  publicada: boolean;
  /**
   * La marca del moderador. Es OTRA cosa que review_status: una noticia
   * puede estar aprobada Y censurada, y en ese caso lo que el autor
   * tiene que leer es la censura.
   */
  censoredAt: string | null;
  censorReason: string | null;
};

function mapMiNoticia(r: Record<string, unknown>): MiNoticia {
  return {
    id: Number(r.id),
    tag: r.tag as string,
    date: toISODate(r.news_date),
    title: r.title as string,
    excerpt: r.excerpt as string,
    authorSlug: r.author_collective_slug as string,
    authorName: (r.author_name as string | null) ?? (r.author_collective_slug as string),
    reviewStatus: r.review_status as MiNoticia["reviewStatus"],
    reviewNote: (r.review_note as string | null) ?? null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as string).toISOString() : null,
    submittedAt: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
    publicada: (r.status as string) === "published" && r.censored_at == null,
    censoredAt: r.censored_at ? new Date(r.censored_at as string).toISOString() : null,
    censorReason: (r.censor_reason as string | null) ?? null,
  };
}

/**
 * Las noticias firmadas por los colectivos y venues de esta cuenta.
 *
 * Por owner_email y no por una lista de slugs que arme el llamador: la
 * pregunta "cuáles son mías" se responde en un solo lugar, y así no hay
 * forma de que una pantalla pida las de otro pasando el slug equivocado.
 *
 * Sin filtro de entity_kind: un venue también firma noticias, y el panel
 * VENUE muestra las suyas con el mismo componente.
 */
export async function getMyNews(email: string, kind?: EntityKind): Promise<MiNoticia[]> {
  const rows = kind
    ? await sql`
        SELECT n.*, c.name AS author_name
        FROM news n JOIN collectives c ON c.slug = n.author_collective_slug
        WHERE lower(c.owner_email) = lower(${email}) AND c.entity_kind = ${kind}
        ORDER BY n.news_date DESC, n.id DESC
      `
    : await sql`
        SELECT n.*, c.name AS author_name
        FROM news n JOIN collectives c ON c.slug = n.author_collective_slug
        WHERE lower(c.owner_email) = lower(${email})
        ORDER BY n.news_date DESC, n.id DESC
      `;
  return rows.map(mapMiNoticia);
}

/**
 * Las etiquetas que ya se usaron, de la más usada a la menos.
 *
 * news.tag es texto libre y va a seguir siéndolo: un vocabulario cerrado
 * habría que decidirlo, y no es una decisión que corresponda tomar de
 * paso. Pero mostrar las que ya existen es lo único que evita que la
 * misma cosa termine escrita de cinco formas — es sugerencia, no regla.
 */
export async function getNewsTags(): Promise<string[]> {
  // SOLO DE LO PUBLICADO. Sin el filtro, la etiqueta de un borrador
  // que nadie aprobó —o de una rechazada por spam— aparecía sugerida en
  // el formulario de todos los demás publicadores, que ni administran
  // ese colectivo ni pueden ver esa noticia. Una sugerencia es una
  // recomendación de la casa: no puede salir de algo que la casa
  // todavía no aceptó.
  const rows = await sql`
    SELECT tag, count(*)::int AS n FROM news
    WHERE btrim(tag) <> '' AND status = 'published' AND censored_at IS NULL
    GROUP BY tag ORDER BY n DESC, tag ASC LIMIT 20
  `;
  return rows.map((r) => r.tag as string);
}


/* ===================================================================
 * LO QUE MIRA EL MODERADOR (tanda 5 §4)
 * =================================================================== */

/** Una noticia esperando decisión, con lo necesario para decidirla. */
export type NoticiaEnRevision = {
  id: number;
  tag: string;
  date: string;
  title: string;
  excerpt: string;
  autorSlug: string;
  autorNombre: string;
  autorEsVenue: boolean;
  submittedAt: string | null;
  dias: number;
  /** Cuántas le aprobamos antes a este autor. Contexto, no regla. */
  aprobadasDelAutor: number;
};

/**
 * La cola de noticias de la comunidad. Lo más viejo primero.
 *
 * Trae el nombre del autor y cuántas le aprobamos antes, porque eso es
 * lo que cambia la lectura de un texto dudoso: la primera de alguien que
 * recién llega no se lee igual que la décima de un colectivo que viene
 * publicando bien. Es contexto para decidir, no una regla que decida.
 */
export async function getNewsInReview(): Promise<NoticiaEnRevision[]> {
  const rows = await sql`
    SELECT n.id, n.tag, n.news_date, n.title, n.excerpt, n.submitted_at,
           n.author_collective_slug, c.name AS autor_nombre, c.entity_kind,
           EXTRACT(DAY FROM (now() - n.submitted_at))::int AS dias,
           (SELECT COUNT(*)::int FROM news o
             WHERE o.author_collective_slug = n.author_collective_slug
               AND o.review_status = 'aprobado') AS aprobadas
    FROM news n
    JOIN collectives c ON c.slug = n.author_collective_slug
    WHERE n.review_status = 'en_revision'
    ORDER BY n.submitted_at ASC NULLS LAST, n.id ASC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    tag: r.tag as string,
    date: toISODate(r.news_date),
    title: r.title as string,
    excerpt: r.excerpt as string,
    autorSlug: r.author_collective_slug as string,
    autorNombre: r.autor_nombre as string,
    autorEsVenue: (r.entity_kind as string) === "venue",
    submittedAt: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
    dias: Number(r.dias ?? 0),
    aprobadasDelAutor: Number(r.aprobadas ?? 0),
  }));
}

/** Una pieza bajada del sitio por un moderador. */
export type PiezaCensurada = {
  tipo: "artist" | "collective" | "event" | "news" | "set" | "track";
  clave: string;
  titulo: string;
  motivo: string;
  censuradaEn: string;
  censuradaPor: string | null;
};

/**
 * Todo lo que está censurado, de lo más reciente a lo más viejo.
 *
 * Seis consultas y no un UNION: las seis tablas tienen claves de tipos
 * distintos y títulos en columnas distintas, y un UNION obligaría a
 * castear todo a texto para volver a separarlo después. Cada una pega
 * contra su índice parcial, así que son seis lecturas de un puñado de
 * filas.
 */
export async function getCensored(): Promise<PiezaCensurada[]> {
  const partes: Array<{ tipo: PiezaCensurada["tipo"]; tabla: string; clave: string; titulo: string }> = [
    { tipo: "artist", tabla: "artists", clave: "slug", titulo: "name" },
    { tipo: "collective", tabla: "collectives", clave: "slug", titulo: "name" },
    { tipo: "event", tabla: "events", clave: "id", titulo: "title" },
    { tipo: "news", tabla: "news", clave: "id", titulo: "title" },
    { tipo: "set", tabla: "dj_sets", clave: "slug", titulo: "title" },
    { tipo: "track", tabla: "tracks", clave: "slug", titulo: "title" },
  ];
  const todo: PiezaCensurada[] = [];
  for (const p of partes) {
    // Los nombres salen de esta constante, no de ningún request.
    const rows = await sql(
      `SELECT ${p.clave}::text AS clave, ${p.titulo} AS titulo,
              censor_reason, censored_at, censored_by
       FROM ${p.tabla} WHERE censored_at IS NOT NULL`
    );
    for (const r of rows) {
      todo.push({
        tipo: p.tipo,
        clave: r.clave as string,
        titulo: (r.titulo as string) ?? "(sin título)",
        motivo: (r.censor_reason as string) ?? "",
        censuradaEn: new Date(r.censored_at as string).toISOString(),
        censuradaPor: (r.censored_by as string | null) ?? null,
      });
    }
  }
  return todo.sort((a, b) => (a.censuradaEn < b.censuradaEn ? 1 : -1));
}

/** Una cuenta cerrada. */
export type CuentaBaneada = {
  email: string;
  nombre: string | null;
  motivo: string;
  baneadaEn: string;
  baneadaPor: string | null;
  /** Qué queda a su nombre. Para saber qué se está escondiendo. */
  artistas: string[];
};

export async function getBannedAccounts(): Promise<CuentaBaneada[]> {
  const rows = await sql`
    SELECT u.email, u.display_name, u.ban_reason, u.banned_at, u.banned_by,
           COALESCE((SELECT array_agg(a.name ORDER BY a.slug) FROM artists a
                      WHERE lower(a.owner_email) = lower(u.email)), '{}') AS artistas
    FROM user_profiles u
    WHERE u.banned_at IS NOT NULL
    ORDER BY u.banned_at DESC
  `;
  return rows.map((r) => ({
    email: r.email as string,
    nombre: (r.display_name as string | null) ?? null,
    motivo: (r.ban_reason as string) ?? "",
    baneadaEn: new Date(r.banned_at as string).toISOString(),
    baneadaPor: (r.banned_by as string | null) ?? null,
    artistas: (r.artistas as string[]) ?? [],
  }));
}

/** Un evento cuyo lineup todavía no enganchó nadie con su perfil. */
export type LineupPendiente = {
  id: number;
  title: string;
  date: string;
  lineup: string;
  entradas: number;
  sinResolver: number;
};

/**
 * Los eventos con lineup por enganchar, los más próximos primero.
 *
 * Sale de /admin/eventos, que se va con el CMS. Esto NO es creación de
 * contenido: es lo que convierte el texto de un flyer en vínculos a
 * perfiles reales, y de eso depende que un toque aparezca en el press
 * kit del DJ y cuente en sus números. Con los eventos de la comunidad
 * hay MÁS lineups que enganchar, no menos.
 */
export async function getLineupsPendientes(): Promise<LineupPendiente[]> {
  const rows = await sql`
    SELECT e.id, e.title, e.event_date, e.lineup,
           COUNT(el.id)::int AS entradas,
           COUNT(*) FILTER (WHERE el.artist_slug IS NULL AND el.collective_slug IS NULL)::int AS sin_resolver
    FROM events e
    LEFT JOIN event_lineup el ON el.event_id = e.id
    WHERE e.status = 'published' AND e.censored_at IS NULL
      AND e.lineup_reviewed_at IS NULL
    GROUP BY e.id, e.title, e.event_date, e.lineup
    ORDER BY e.event_date DESC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title as string,
    date: toISODate(r.event_date),
    lineup: r.lineup as string,
    entradas: Number(r.entradas ?? 0),
    sinResolver: Number(r.sin_resolver ?? 0),
  }));
}

/** Un evento propio, con lo que el organizador necesita ver y corregir. */
export type MiEvento = {
  id: number;
  title: string;
  date: string;
  endAt: string | null;
  venue: string;
  city: string;
  lineup: string;
  flyerUrl: string | null;
  organizerSlug: string;
  organizerName: string;
  /** Si un moderador lo bajó, y por qué. */
  censoredAt: string | null;
  censorReason: string | null;
  /** Boletas y pedidos: si hay, no se puede borrar. */
  vendidas: number;
};

/**
 * Los eventos de los colectivos y venues de esta cuenta.
 *
 * Por owner_email, igual que getMyNews: la pregunta "cuáles son míos" se
 * responde en un solo lugar y no hay forma de pedir los de otro pasando
 * el slug equivocado.
 *
 * Trae los censurados: son justamente los que el organizador tiene que
 * poder ver para leer el motivo.
 */
export async function getMyEvents(email: string, kind?: EntityKind): Promise<MiEvento[]> {
  const rows = kind
    ? await sql`
        SELECT e.*, c.name AS organizer_name,
               (SELECT COUNT(*)::int FROM tickets WHERE event_id = e.id)
             + (SELECT COUNT(*)::int FROM order_items WHERE event_id = e.id) AS vendidas
        FROM events e JOIN collectives c ON c.slug = e.organizer_slug
        WHERE lower(c.owner_email) = lower(${email}) AND c.entity_kind = ${kind}
        ORDER BY e.event_date DESC, e.id DESC
      `
    : await sql`
        SELECT e.*, c.name AS organizer_name,
               (SELECT COUNT(*)::int FROM tickets WHERE event_id = e.id)
             + (SELECT COUNT(*)::int FROM order_items WHERE event_id = e.id) AS vendidas
        FROM events e JOIN collectives c ON c.slug = e.organizer_slug
        WHERE lower(c.owner_email) = lower(${email})
        ORDER BY e.event_date DESC, e.id DESC
      `;
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title as string,
    date: toISODate(r.event_date),
    endAt: r.end_at ? new Date(r.end_at as string).toISOString() : null,
    venue: r.venue as string,
    city: r.city as string,
    lineup: r.lineup as string,
    flyerUrl: (r.flyer_url as string | null) ?? null,
    organizerSlug: r.organizer_slug as string,
    organizerName: (r.organizer_name as string) ?? (r.organizer_slug as string),
    censoredAt: r.censored_at ? new Date(r.censored_at as string).toISOString() : null,
    censorReason: (r.censor_reason as string | null) ?? null,
    vendidas: Number(r.vendidas ?? 0),
  }));
}

/** Una cesión que alguien te ofreció y todavía no respondiste. */
export type CesionPendiente = {
  id: number;
  collectiveSlug: string;
  collectiveName: string;
  esVenue: boolean;
  /** Quién la ofreció. Puede ser null si esa cuenta se borró. */
  deQuien: string | null;
  ofrecidaEn: string;
  /** Qué vas a heredar. Es lo que hay que saber antes de aceptar. */
  miembros: number;
  eventos: number;
  noticias: number;
};

/**
 * Las cesiones de colectivo esperando TU respuesta (§8 A).
 *
 * Trae con qué viene el colectivo —miembros, eventos, noticias— porque
 * aceptar es asumir la administración de todo eso, y nadie debería
 * decidirlo a ciegas. Es el mismo criterio que la invitación a colaborar,
 * que dice dónde va a quedar fija la pieza antes de que aceptes.
 */
export async function getCesionesPendientes(email: string): Promise<CesionPendiente[]> {
  const rows = await sql`
    SELECT o.id, o.collective_slug, o.from_email, o.offered_at,
           c.name, c.entity_kind,
           (SELECT COUNT(*)::int FROM artist_collectives m
             WHERE m.collective_slug = o.collective_slug AND m.to_date IS NULL) AS miembros,
           (SELECT COUNT(*)::int FROM events e
             WHERE e.organizer_slug = o.collective_slug) AS eventos,
           (SELECT COUNT(*)::int FROM news n
             WHERE n.author_collective_slug = o.collective_slug) AS noticias
    FROM collective_ownership o
    JOIN collectives c ON c.slug = o.collective_slug
    WHERE o.kind = 'cesion' AND lower(o.to_email) = lower(${email})
      AND o.accepted_at IS NULL AND o.declined_at IS NULL AND o.revoked_at IS NULL
    ORDER BY o.offered_at ASC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    collectiveSlug: r.collective_slug as string,
    collectiveName: r.name as string,
    esVenue: (r.entity_kind as string) === "venue",
    deQuien: (r.from_email as string | null) ?? null,
    ofrecidaEn: new Date(r.offered_at as string).toISOString(),
    miembros: Number(r.miembros ?? 0),
    eventos: Number(r.eventos ?? 0),
    noticias: Number(r.noticias ?? 0),
  }));
}
