/**
 * LA PUERTA DE UN COLECTIVO, EN SU PROPIO ARCHIVO.
 *
 * Vive separada de collectives-write por una razón concreta y no por orden:
 * lib/residency-offers-write.ts necesita preguntar quién administra un
 * colectivo, y collectives-write necesita conceder la residencia del fundador.
 * Con la puerta dentro de collectives-write eso es un ciclo de imports —cada
 * archivo pidiéndole algo al otro— que en ESM a veces anda y a veces deja un
 * export en undefined según el orden de carga, sin decir por qué.
 *
 * Acá abajo no se importa nada de los dos, así que el ciclo no existe.
 * collectives-write re-exporta todo esto para que ningún llamador de antes
 * tenga que cambiar de dónde lo trae.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { isSuperAdmin } from "./roles-check";

const sql = neon(process.env.DATABASE_URL!);

/**
 * residente — el colectivo principal del DJ. UNO SOLO, y solo un colectivo:
 *             en un venue se es miembro, no residente. Desde §8 fase 2 esto
 *             NO es una etiqueta: es PERMISO PARA EDITAR el colectivo.
 * miembro   — el vínculo general. Varios a la vez, colectivos o venues, y no
 *             edita nada.
 *
 * CUIDADO AL LEER CUALQUIER COSA VIEJA, Y ACÁ HAY QUE CONTAR LA HISTORIA
 * ENTERA. Esta palabra cambió de significado TRES veces:
 *
 *   tanda 3        'residente' = el núcleo   ('toca_con' = el vínculo general)
 *   tanda 3 pieza 2 'casa'     = el núcleo   ('residente' = el vínculo general)
 *   §8 fase 1      'casa'      = el núcleo   ('miembro'   = el vínculo general)
 *   §8 fase 2      'residente' = el núcleo   ('miembro'   = el vínculo general)
 *
 * O sea que "residente" significó el núcleo, después el vínculo general, y
 * ahora otra vez el núcleo — pero esta vez con permisos que antes no tenía.
 * Antes de creerle a un comentario, fijate de qué tanda es.
 */
export type MembershipKind = "residente" | "miembro";

export type WriteResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/**
 * ============================================================
 * LA PUERTA ESTÁ PARTIDA EN TRES, Y NO EN DOS
 * ============================================================
 *
 * Hasta la fase 2 había una sola pregunta —"¿podés tocar este colectivo?"— y
 * una sola respuesta: el dueño y el SUPER_ADMIN. Con los residentes editando,
 * "tocar" deja de ser una cosa sola, porque hay cosas que un residente SÍ
 * puede y cosas que NO.
 *
 *   canEditCollective         dueño · residente · SUPER_ADMIN
 *     CONTENIDO: eventos, noticias, géneros, imágenes, la info del perfil.
 *
 *   puedeAdministrarColectivo dueño · SUPER_ADMIN
 *     MEMBRESÍAS Y PLATA: invitar, quitar, aceptar postulaciones, ofrecer
 *     residencias, y todo lo que toque ventas, pedidos o atribución.
 *
 *   esDuenoDelColectivo       dueño, y NADIE más
 *     CEDER, DESAMPARAR, ELIMINAR. Ni el SUPER_ADMIN, que para eso tiene sus
 *     propias rutas de moderación con su propio registro.
 *
 * POR QUÉ TRES Y NO DOS, que es lo que parecía alcanzar: si las membresías
 * cayeran en esDuenoDelColectivo, el SUPER_ADMIN perdería la capacidad de
 * arreglar un colectivo cuyo dueño desapareció, que hoy tiene. Eso es
 * exactamente lo que la regla de la transición prohíbe — el destino puede ser
 * mejor, pero nada puede quedar peor que antes. El escalón del medio existe
 * para no romper la moderación mientras se le cierra la puerta al residente.
 */
export type RolSobreColectivo = "dueno" | "residente" | "super_admin";

/**
 * El primitivo: QUÉ es esta cuenta respecto de este colectivo, o null.
 *
 * Devuelve el rol y no un booleano porque edit_log necesita escribir CUÁL de
 * los tres hizo cada edición, y derivarlo dos veces en dos lugares es la
 * forma más común de que los dos se desincronicen. Una sola respuesta.
 *
 * El orden importa: dueño primero. Si el SUPER_ADMIN además es el dueño, es
 * el dueño — es su colectivo, no un acto de moderación, y el registro tiene
 * que decir eso.
 */
export async function rolSobreColectivo(
  slug: string,
  email?: string | null
): Promise<RolSobreColectivo | null> {
  if (!email) return null;
  const rows = await sql`SELECT owner_email FROM collectives WHERE slug = ${slug}`;
  if (rows.length === 0) return null;

  const owner = rows[0].owner_email as string | null;
  if (owner && owner.toLowerCase() === email.toLowerCase()) return "dueno";

  /**
   * Residente: el dueño de un perfil de artista con un vínculo 'residente'
   * ACTIVO y ACEPTADO en este colectivo.
   *
   * accepted_at IS NOT NULL no es decorativo aunque hoy parezca redundante.
   * PENDING_KIND es 'miembro', así que una fila pendiente no debería poder
   * ser 'residente' nunca — pero eso es un invariante del código, y si algún
   * día se rompe, lo que se filtra por acá es PERMISO DE EDICIÓN. Una guarda
   * que depende de que otro archivo siga siendo correcto no es una guarda.
   *
   * banned_at IS NULL por lo mismo que getCandidatosCesion lo pide: una
   * cuenta baneada no actúa. No es una regla nueva, es la de siempre.
   */
  const residente = await sql`
    SELECT 1
    FROM artist_collectives ac
    JOIN artists a ON a.slug = ac.artist_slug
    JOIN user_profiles u ON lower(u.email) = lower(a.owner_email)
    WHERE ac.collective_slug = ${slug}
      AND ac.kind = 'residente'
      AND ac.to_date IS NULL
      AND ac.accepted_at IS NOT NULL
      AND lower(u.email) = lower(${email})
      AND u.banned_at IS NULL
    LIMIT 1
  `;
  if (residente.length > 0) return "residente";

  return (await isSuperAdmin(email)) ? "super_admin" : null;
}

/**
 * Puede editar el CONTENIDO del colectivo: dueño, residente o SUPER_ADMIN.
 *
 * Mantiene el nombre y la firma de antes a propósito. Es la puerta que ya
 * usan events-write, news-write, genres-write, /api/upload y la página del
 * colectivo, y lo único que cambia es que ahora también la pasa el residente
 * — que es justamente el permiso que la fase 2 concede.
 */
export async function canEditCollective(slug: string, email?: string | null): Promise<boolean> {
  return (await rolSobreColectivo(slug, email)) !== null;
}

/**
 * Puede administrar MEMBRESÍAS y ver o tocar PLATA: dueño o SUPER_ADMIN.
 *
 * El residente queda afuera, y es el punto de toda la fase 2: editar el
 * perfil no es decidir quién entra al colectivo. Si un residente pudiera
 * invitar, podría invitar a otro residente, y el permiso se repartiría solo
 * sin que el dueño se enterara.
 */
export async function puedeAdministrarColectivo(
  slug: string,
  email?: string | null
): Promise<boolean> {
  const rol = await rolSobreColectivo(slug, email);
  return rol === "dueno" || rol === "super_admin";
}

/**
 * Es EL DUEÑO. Ni residente ni SUPER_ADMIN.
 *
 * Para ceder, desamparar y eliminar, que no son editar. Ya era así —ceder
 * leía owner_email a mano—; esto le pone nombre para que el próximo que
 * necesite "solo el dueño" no tenga que volver a escribir la consulta ni
 * caiga en canEditCollective porque estaba a mano.
 */
export async function esDuenoDelColectivo(
  slug: string,
  email?: string | null
): Promise<boolean> {
  return (await rolSobreColectivo(slug, email)) === "dueno";
}
