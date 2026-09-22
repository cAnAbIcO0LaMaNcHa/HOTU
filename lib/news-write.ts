/**
 * Noticias de la comunidad: las publica un colectivo o un venue, y pasan
 * por una cola de aprobación antes de ser públicas (tanda 5 §3).
 *
 * ============================================================
 * POR QUÉ ESTAS SÍ TIENEN COLA Y LOS EVENTOS NO
 * ============================================================
 *
 * Un evento tiene fecha: una cola entre el anuncio y la puerta pone al
 * admin en el camino crítico de la agenda de la escena. Una noticia no
 * caduca, y es texto libre en la portada del sitio — que es exactamente
 * la superficie donde el spam paga. Por eso la migración de este paso le
 * puso review_status a news y no a events.
 *
 * ============================================================
 * DOS ESTADOS, Y NO SON EL MISMO
 * ============================================================
 *
 *   status        — si es PÚBLICA. Lo mueve la aprobación, nadie más.
 *   review_status — DÓNDE ESTÁ en la cola. Lo mueven el autor y el
 *                   moderador, cada uno con sus transiciones.
 *
 * Están separados por lo mismo que en artists: si "sin aprobar" se
 * escribiera como 'draft' a secas, el autor lo leería como borrador
 * propio y lo volvería a mandar sin enterarse de que alguien lo decidió.
 *
 * ============================================================
 * UNA NOTICIA APROBADA NO LA EDITA EL AUTOR
 * ============================================================
 *
 * Es la razón de ser de la cola. Si el autor pudiera editar después de
 * la aprobación, mandaría a revisar un texto inocuo y lo reescribiría al
 * minuto de publicado: la revisión no habría revisado nada. Se corrige
 * publicando otra, o el moderador la baja.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { canEditCollective, type WriteResult } from "./collectives-write";
import { isModerator } from "./roles-check";
import { limpiarTexto, limpiarYRecortar, validarFecha } from "./texto";

const sql = neon(process.env.DATABASE_URL!);

/** Igual que en lib/events-write.ts. */
const DISTRITO_CONGELADO = "D00";

export type ReviewStatus = "borrador" | "en_revision" | "rechazado" | "aprobado";

export type NuevaNoticia = {
  /** El colectivo o venue que la firma. Decide también quién puede. */
  authorCollectiveSlug?: unknown;
  title?: unknown;
  excerpt?: unknown;
  tag?: unknown;
  /** YYYY-MM-DD. Si falta, hoy. */
  date?: unknown;
  /** false para dejarla en borrador en vez de mandarla a revisión. */
  enviar?: unknown;
};

/**
 * El mínimo para que un moderador tenga algo que leer.
 *
 * Se aplica al crear Y al enviar, no solo en el formulario: el
 * formulario es presentación, y la app va a llamar al mismo lib.
 */
function validarContenido(
  title: string,
  excerpt: string,
  tag: string
): { error: string } | null {
  if (title.length < 4) return { error: "El título necesita al menos 4 letras" };
  if (excerpt.length < 20) {
    return { error: "Contá un poco más: al menos 20 caracteres" };
  }
  if (!tag) return { error: "Poné una etiqueta (RELEASE, CLUB, FIESTA...)" };
  return null;
}

/**
 * La etiqueta, normalizada a mayúsculas.
 *
 * news.tag es texto libre y el admin ya cargó RELEASE, CLUB y GEAR. Sin
 * normalizar, "club" y "CLUB" serían dos etiquetas distintas en la misma
 * lista y nadie entendería por qué. Es el mismo criterio que el índice
 * único sobre upper(dj_code).
 */
function normalizarTag(v: unknown): string {
  return limpiarYRecortar(limpiarTexto(v).toUpperCase().replace(/\s+/g, " "), 24);
}

/**
 * La fecha de una noticia NO PUEDE ESTAR EN EL FUTURO.
 *
 * /noticias y la home ordenan por news_date DESC y la home se queda con
 * las tres primeras. Una noticia fechada en el 9999 es un anclaje
 * permanente arriba de todo — exactamente el "botón para autodestacarse
 * en la home" que el formulario de eventos dice no ofrecer, entrando por
 * la otra puerta. Y como el moderador aprueba texto, no fechas, se le
 * cuela mirando.
 *
 * Dejarla vacía significa hoy, que es lo que quiere el 99% de los casos.
 */
function fechaDeNoticia(v: unknown) {
  return validarFecha(v, { maxAnios: 0 });
}

/* ===================================================================
 * EL LADO DEL AUTOR
 * =================================================================== */

export async function createCommunityNews(
  input: NuevaNoticia,
  email?: string | null
): Promise<WriteResult<{ id: number; reviewStatus: ReviewStatus }>> {
  if (!email) return { ok: false, status: 403, error: "Not signed in" };

  const autor = limpiarTexto(input.authorCollectiveSlug);
  if (!autor) return { ok: false, status: 400, error: "Decí a nombre de quién la publicás" };

  const [col] = await sql`SELECT slug, censored_at FROM collectives WHERE slug = ${autor}`;
  if (!col) return { ok: false, status: 404, error: "Ese colectivo no existe" };

  /**
   * UN COLECTIVO CENSURADO NO PUBLICA NADA NUEVO.
   *
   * Sin esto, censurar escondía su página y no frenaba nada más: la
   * entidad bajada seguía produciendo contenido público, en vivo, con su
   * propia página en 404. Una moderación que no detiene lo que vino a
   * detener no es moderación, es una cortina.
   *
   * EDITAR lo que ya existe SÍ se puede —igual que con un evento
   * censurado—, porque la censura trae un motivo, el motivo suele ser
   * algo que se arregla, y editar no devuelve nada al sitio. La línea
   * está entre corregir lo tuyo y estrenar algo nuevo mientras estás
   * bajado.
   */
  if (col.censored_at) {
    return {
      ok: false,
      status: 409,
      error:
        "Este perfil está bajado por moderación, así que no puede publicar nada nuevo. " +
        "El motivo está en tu panel. Cuando se resuelva, volvés a publicar.",
    };
  }
  if (!(await canEditCollective(autor, email))) {
    return {
      ok: false,
      status: 403,
      error: "Solo quien administra ese colectivo publica a su nombre",
    };
  }

  const title = limpiarYRecortar(input.title, 200);
  const excerpt = limpiarYRecortar(input.excerpt, 4000);
  const tag = normalizarTag(input.tag);
  const mal = validarContenido(title, excerpt, tag);
  if (mal) return { ok: false, status: 400, error: mal.error };

  const f = fechaDeNoticia(input.date);
  if ("error" in f) return { ok: false, status: 400, error: f.error };

  // Mandar a revisar es el default: es lo que quiere quien apretó
  // publicar. El borrador es la salida para el que no terminó.
  const enviar = input.enviar !== false;
  const reviewStatus: ReviewStatus = enviar ? "en_revision" : "borrador";

  /**
   * status SIEMPRE 'draft' acá, y nombrado explícito aunque el DEFAULT
   * ya lo diga. Apoyarse en el default obligaría a verificar que main
   * tenga exactamente el mismo schema antes de cada despliegue, y esta
   * es la línea que decide si un texto sin revisar sale a la portada.
   */
  const [fila] = await sql`
    INSERT INTO news
      (tag, news_date, title, excerpt, district, scope, country_code, language,
       status, featured, priority_at, author_collective_slug, review_status, submitted_at)
    VALUES
      (${tag}, ${f.date}, ${title}, ${excerpt}, ${DISTRITO_CONGELADO},
       'country', 'COL', 'es', 'draft', false, NULL,
       ${autor}, ${reviewStatus}, ${enviar ? new Date().toISOString() : null})
    RETURNING id
  `;

  return { ok: true, value: { id: Number(fila.id), reviewStatus } };
}

/**
 * Quién es el dueño de una noticia, y en qué estado está.
 *
 * Devuelve null cuando no existe o cuando NO TIENE AUTOR: las noticias
 * de HOTU —las que cargó el admin antes de que existiera este camino—
 * tienen author_collective_slug NULL y no son de nadie que pueda entrar
 * por acá. Sin esa condición, cualquier dueño de colectivo podría
 * editarlas: el chequeo de permiso corre contra el slug del autor, y con
 * NULL no hay contra qué correrlo.
 */
async function cargarPropia(
  id: number,
  email?: string | null
): Promise<
  | { ok: true; autor: string; reviewStatus: ReviewStatus; status: string }
  | { ok: false; status: 403 | 404; error: string }
> {
  if (!Number.isInteger(id)) return { ok: false, status: 404, error: "Noticia no encontrada" };
  const [n] = await sql`
    SELECT author_collective_slug, review_status, status FROM news WHERE id = ${id}
  `;
  if (!n || !n.author_collective_slug) {
    return { ok: false, status: 404, error: "Noticia no encontrada" };
  }
  const autor = n.author_collective_slug as string;
  if (!(await canEditCollective(autor, email))) {
    return { ok: false, status: 403, error: "Esa noticia no es tuya" };
  }
  return {
    ok: true,
    autor,
    reviewStatus: n.review_status as ReviewStatus,
    status: n.status as string,
  };
}

export type ParcheNoticia = {
  title?: unknown;
  excerpt?: unknown;
  tag?: unknown;
  date?: unknown;
};

/**
 * Edita una noticia propia que todavía no decidió nadie.
 *
 * Refuse en 'en_revision' por lo mismo que el perfil de DJ: quien la
 * revisa tiene que ver lo que se le mandó. Para editarla hay que
 * retirarla primero, que es un click y deja rastro.
 *
 * Y refuse en 'aprobado' por la razón de arriba: editar después de la
 * aprobación vaciaría la cola de sentido.
 */
export async function updateCommunityNews(
  id: number,
  patch: ParcheNoticia,
  email?: string | null
): Promise<WriteResult<{ id: number }>> {
  const propia = await cargarPropia(id, email);
  if (!propia.ok) return propia;

  if (propia.reviewStatus === "en_revision") {
    return {
      ok: false,
      status: 409,
      error: "Está en revisión. Retirala primero si querés cambiarla.",
    };
  }
  /**
   * LA GUARDA ES status, NO review_status. Acá había un agujero real.
   *
   * Esto miraba solo review_status, y deleteCommunityNews —en este mismo
   * archivo— miraba los dos. El par inconsistente
   * status='published' + review_status='rechazado' es alcanzable HOY:
   * el Server Action updateNews del admin escribe status desde su select
   * y no toca review_status, así que un moderador que publica una
   * noticia de la comunidad desde /admin/noticias deja exactamente eso.
   *
   * Con la guarda vieja, el autor de esa noticia podía reescribirla
   * entera estando en portada, que es literalmente la escapatoria que la
   * cola existe para cerrar. Y el panel le decía "no se aprobó todavía,
   * solo la ves vos" mientras estaba en vivo.
   *
   * "Publicada" es una propiedad de status. review_status dice dónde
   * está en la cola, que es otra pregunta.
   */
  if (propia.status === "published" || propia.reviewStatus === "aprobado") {
    return {
      ok: false,
      status: 409,
      error: "Ya está publicada y no se edita. Publicá otra, o pedile al equipo que la baje.",
    };
  }

  // Una clave ausente significa "dejalo como está". Una cadena vacía no
  // puede borrar nada acá: los cuatro campos son NOT NULL.
  const [actual] = await sql`SELECT tag, title, excerpt FROM news WHERE id = ${id}`;

  const title =
    patch.title === undefined ? String(actual.title) : limpiarYRecortar(patch.title, 200);
  const excerpt =
    patch.excerpt === undefined ? String(actual.excerpt) : limpiarYRecortar(patch.excerpt, 4000);
  const tag = patch.tag === undefined ? String(actual.tag) : normalizarTag(patch.tag);

  const mal = validarContenido(title, excerpt, tag);
  if (mal) return { ok: false, status: 400, error: mal.error };

  /**
   * news_date NO se relee para reescribirla igual.
   *
   * Traerla y volver a mandarla obliga a convertir un DATE a texto y de
   * vuelta, y esa conversión pasa por la zona horaria del server: una
   * fecha que vuelve como Date y se re-serializa puede correrse un día
   * sin que nadie toque nada. Con el COALESCE, "sin fecha en el parche"
   * es literalmente "no la toques".
   */
  /**
   * null y "" son "no la toques", igual que undefined.
   *
   * Solo undefined lo era, y el <input type="date"> del editor manda ""
   * en cuanto no puede representar lo guardado: pedir un cambio de
   * título terminaba moviendo la fecha a HOY sin que nadie la tocara.
   * Una fecha vacía desde un parche no es una fecha nueva, es la
   * ausencia de una.
   */
  let date: string | null = null;
  if (patch.date !== undefined && patch.date !== null && limpiarTexto(patch.date) !== "") {
    const f = fechaDeNoticia(patch.date);
    if ("error" in f) return { ok: false, status: 400, error: f.error };
    date = f.date;
  }

  // El WHERE repite el estado: si un moderador decidió entre la lectura
  // de arriba y este UPDATE, esto no pisa su decisión.
  const filas = await sql`
    UPDATE news SET tag = ${tag}, news_date = COALESCE(${date}::date, news_date),
                    title = ${title}, excerpt = ${excerpt}
    WHERE id = ${id} AND review_status IN ('borrador','rechazado') AND status <> 'published'
    RETURNING id
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Alguien la movió mientras la editabas. Recargá." };
  }
  return { ok: true, value: { id } };
}

/** El autor la manda a la cola. Desde borrador o desde rechazada. */
export async function submitNewsForReview(
  id: number,
  email?: string | null
): Promise<WriteResult<{ enviada: true }>> {
  const propia = await cargarPropia(id, email);
  if (!propia.ok) return propia;

  if (propia.reviewStatus === "en_revision") return { ok: true, value: { enviada: true } };
  // Igual que arriba: publicada es status, no review_status.
  if (propia.status === "published" || propia.reviewStatus === "aprobado") {
    return { ok: false, status: 409, error: "Ya está publicada" };
  }

  const [n] = await sql`SELECT tag, title, excerpt FROM news WHERE id = ${id}`;
  const mal = validarContenido(
    limpiarTexto(n.title),
    limpiarTexto(n.excerpt),
    limpiarTexto(n.tag)
  );
  if (mal) return { ok: false, status: 400, error: mal.error };

  const filas = await sql`
    UPDATE news SET review_status = 'en_revision', submitted_at = now()
    WHERE id = ${id} AND review_status IN ('borrador','rechazado') AND status <> 'published'
    RETURNING id
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Alguien la movió. Recargá." };
  }
  return { ok: true, value: { enviada: true } };
}

/**
 * El autor la retira de la cola y vuelve a borrador.
 *
 * El motivo del rechazo anterior NO se limpia acá, igual que en el
 * perfil de DJ: mientras el autor no vuelva a mandarla, tiene que poder
 * seguir leyendo por qué se la rechazaron.
 */
export async function withdrawNewsFromReview(
  id: number,
  email?: string | null
): Promise<WriteResult<{ retirada: true }>> {
  const propia = await cargarPropia(id, email);
  if (!propia.ok) return propia;

  if (propia.reviewStatus !== "en_revision") {
    return { ok: false, status: 409, error: "Esa noticia no está esperando revisión" };
  }

  const filas = await sql`
    UPDATE news SET review_status = 'borrador', submitted_at = NULL
    WHERE id = ${id} AND review_status = 'en_revision'
    RETURNING id
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Alguien la decidió mientras tanto. Recargá." };
  }
  return { ok: true, value: { retirada: true } };
}

/**
 * El autor borra una propia que todavía no se publicó.
 *
 * Solo sin publicar. Una noticia aprobada ya salió: bajarla es una
 * decisión de moderación, no del autor, y si el autor pudiera borrarla
 * tendría la misma escapatoria que editarla.
 */
export async function deleteCommunityNews(
  id: number,
  email?: string | null
): Promise<WriteResult<{ borrada: true }>> {
  const propia = await cargarPropia(id, email);
  if (!propia.ok) return propia;

  if (propia.reviewStatus === "aprobado" || propia.status === "published") {
    return { ok: false, status: 409, error: "Ya está publicada y no la podés borrar" };
  }

  const filas = await sql`
    DELETE FROM news
    WHERE id = ${id} AND review_status <> 'aprobado' AND status <> 'published'
    RETURNING id
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Alguien la publicó mientras tanto. Recargá." };
  }
  return { ok: true, value: { borrada: true } };
}

/* ===================================================================
 * EL LADO DEL MODERADOR
 * =================================================================== */

/**
 * MODERAR LA COLA ES DE UN MODERADOR, NO DE UN SUPER_ADMIN.
 *
 * Estas dos funciones pedían isSuperAdmin porque se escribieron antes
 * de que existiera el rol. El resultado era que un MODERATOR veía la
 * cola entera y recibía 403 al apretar aprobar: un botón que existe y
 * no funciona, que es peor que no tener el botón.
 *
 * Un SUPER_ADMIN sigue pudiendo: isModerator lo incluye.
 */

/**
 * Aprueba y PUBLICA. Las dos cosas en la misma sentencia a propósito:
 * aprobar sin publicar deja una noticia que el autor ve aprobada y nadie
 * más ve, que es el peor de los dos estados posibles.
 *
 * El WHERE repite 'en_revision' para no publicar algo que el autor
 * retiró en el medio.
 */
export async function approveNews(
  id: number,
  adminEmail?: string | null
): Promise<WriteResult<{ aprobada: true }>> {
  if (!adminEmail || !(await isModerator(adminEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador aprueba noticias" };
  }
  if (!Number.isInteger(id)) return { ok: false, status: 404, error: "Noticia no encontrada" };

  const filas = await sql`
    UPDATE news
    SET status = 'published', review_status = 'aprobado',
        review_note = NULL, reviewed_at = now(), reviewed_by = ${adminEmail}
    WHERE id = ${id} AND review_status = 'en_revision'
    RETURNING id
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Esa noticia ya no está esperando revisión" };
  }
  return { ok: true, value: { aprobada: true } };
}

/**
 * Rechaza, CON MOTIVO.
 *
 * El motivo es obligatorio acá y también en la base: el CHECK
 * news_rechazo_con_motivo_check no deja guardar un rechazo sin texto, y
 * recorta con el mismo juego de blancos que artists para que un motivo
 * que quedó en un salto de línea no pase por lleno. Dos guardas para lo
 * mismo: un rechazo mudo es una noticia que nadie corrige nunca.
 *
 * NO toca status. La noticia sigue siendo un borrador, que es lo que ya
 * era: rechazar no despublica nada, porque nunca estuvo publicada.
 */
export async function rejectNews(
  id: number,
  note: unknown,
  adminEmail?: string | null
): Promise<WriteResult<{ rechazada: true }>> {
  if (!adminEmail || !(await isModerator(adminEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador rechaza noticias" };
  }
  if (!Number.isInteger(id)) return { ok: false, status: 404, error: "Noticia no encontrada" };

  const motivo = typeof note === "string" ? note.trim() : "";
  if (motivo.length < 10) {
    return {
      ok: false,
      status: 400,
      error: "El motivo tiene que explicar qué corregir: al menos 10 caracteres",
    };
  }

  const filas = await sql`
    UPDATE news
    SET review_status = 'rechazado', review_note = ${motivo.slice(0, 2000)},
        reviewed_at = now(), reviewed_by = ${adminEmail}
    WHERE id = ${id} AND review_status = 'en_revision'
    RETURNING id
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Esa noticia ya no está esperando revisión" };
  }
  return { ok: true, value: { rechazada: true } };
}
