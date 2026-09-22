/**
 * Moderación: censurar contenido y banear cuentas (tanda 5 §4).
 *
 * Es lo único que el admin hace desde esta tanda. Dejó de ser un CMS.
 *
 * ============================================================
 * CENSURAR NO ES DESPUBLICAR
 * ============================================================
 *
 * La marca es propia (censored_at) y no toca status. Si censurar fuera
 * poner status='draft', el autor lo leería como un borrador SUYO y lo
 * republicaría sin enterarse nunca de que lo moderaron; y al revés, algo
 * que el autor despublicó por su cuenta no puede aparecer marcado como
 * censurado. Son dos hechos, de dos personas.
 *
 * El autor ve la marca y el motivo, y no la puede sacar. Solo un
 * moderador la saca.
 *
 * ============================================================
 * EL BAN OCULTA LO PROPIO, Y "OCULTO" SE DERIVA, NO SE COPIA
 * ============================================================
 *
 * Banear escribe UNA fila: user_profiles.banned_at. No marca el
 * contenido. Que el perfil de artista, sus sets y sus tracks dejen de
 * verse es una CONSECUENCIA que las lecturas calculan mirando el ban.
 *
 * La alternativa —copiar una marca a cada fila al banear— obliga a
 * des-copiarla exactamente en las filas correctas al levantar el ban, y
 * se enreda sin remedio con lo que un moderador haya censurado por
 * separado en el medio: al levantar el ban habría que adivinar cuál de
 * las dos marcas le puso quién. El hecho registrado es el ban; "está
 * oculto" se desprende de él.
 *
 * QUÉ ALCANZA, exactamente: el perfil de artista de la cuenta, y sus
 * sets y tracks. NO alcanza a los colectivos que era dueña ni a lo que
 * esos colectivos publicaron: un colectivo es de varios, hay miembros
 * que no hicieron nada, y hay gente con boletas compradas para sus
 * fiestas. El colectivo queda SIN DUEÑO y sigue en pie. Lo puntual que
 * esté mal se censura de a uno, que es para lo que existe la censura.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { isModerator } from "./roles-check";
import { limpiarTexto, recortar } from "./texto";
import type { WriteResult } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Qué se puede censurar, y dónde vive.
 *
 * `clave` es el nombre de la columna que identifica la fila, porque en
 * este schema las PK no son todas del mismo tipo: artists y collectives
 * tienen slug TEXT, y events, news, dj_sets y tracks... también varían.
 * Se declara una vez acá en vez de ramificar en cada función.
 */
const OBJETIVOS = {
  artist: { tabla: "artists", clave: "slug", tipoClave: "text", que: "el perfil de DJ" },
  collective: { tabla: "collectives", clave: "slug", tipoClave: "text", que: "el colectivo" },
  event: { tabla: "events", clave: "id", tipoClave: "int", que: "el evento" },
  news: { tabla: "news", clave: "id", tipoClave: "int", que: "la noticia" },
  set: { tabla: "dj_sets", clave: "slug", tipoClave: "text", que: "el set" },
  track: { tabla: "tracks", clave: "slug", tipoClave: "text", que: "el track" },
} as const;

export type TipoContenido = keyof typeof OBJETIVOS;

export const TIPOS_CONTENIDO = Object.keys(OBJETIVOS) as TipoContenido[];

export function esTipoContenido(v: unknown): v is TipoContenido {
  return typeof v === "string" && v in OBJETIVOS;
}

/**
 * El mínimo que tiene que decir un motivo.
 *
 * Mismo umbral que el rechazo de un perfil, y por lo mismo: el motivo es
 * lo único que el autor recibe. Un "no" de tres letras no le dice qué
 * corregir, y contenido que desaparece sin explicación es por donde la
 * gente se va de una plataforma.
 *
 * La base lo exige también, con un CHECK por tabla. Dos guardas para lo
 * mismo: el CHECK no puede pedir 10 caracteres, y esto no puede
 * garantizar que nadie escriba por otro camino.
 */
function validarMotivo(note: unknown): { motivo: string } | { error: string } {
  const motivo = limpiarTexto(note);
  if (motivo.length < 10) {
    return { error: "El motivo tiene que explicar qué pasó: al menos 10 caracteres" };
  }
  return { motivo: recortar(motivo, 2000) };
}

/* ===================================================================
 * CENSURA
 * =================================================================== */

/**
 * Baja una pieza del sitio, con motivo.
 *
 * El UPDATE pide `censored_at IS NULL` para que censurar dos veces no
 * pise el motivo y la fecha del primero: la primera decisión es la que
 * vale, y la segunda no tiene nada nuevo que aportar. Devuelve 409 para
 * que el moderador vea que ya estaba, en vez de creer que acaba de
 * hacerlo.
 */
export async function censurar(
  tipo: unknown,
  clave: unknown,
  motivoCrudo: unknown,
  moderadorEmail?: string | null
): Promise<WriteResult<{ censurado: true }>> {
  if (!moderadorEmail || !(await isModerator(moderadorEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador censura contenido" };
  }
  if (!esTipoContenido(tipo)) {
    return { ok: false, status: 400, error: "Ese tipo de contenido no existe" };
  }
  const v = validarMotivo(motivoCrudo);
  if ("error" in v) return { ok: false, status: 400, error: v.error };

  const o = OBJETIVOS[tipo];
  const id = normalizarClave(o.tipoClave, clave);
  if (id === null) return { ok: false, status: 404, error: "No encontré eso" };

  // Los nombres de tabla y columna salen de OBJETIVOS, que es una
  // constante de este archivo: nada de esto viene del request. El valor
  // sí, y va como parámetro.
  const filas = await sql(
    `UPDATE ${o.tabla}
     SET censored_at = now(), censored_by = $1, censor_reason = $2
     WHERE ${o.clave} = $3 AND censored_at IS NULL
     RETURNING ${o.clave}`,
    [moderadorEmail, v.motivo, id]
  );
  if (filas.length === 0) {
    const existe = await sql(`SELECT 1 FROM ${o.tabla} WHERE ${o.clave} = $1`, [id]);
    return existe.length === 0
      ? { ok: false, status: 404, error: "No encontré eso" }
      : { ok: false, status: 409, error: "Ya estaba censurado" };
  }
  return { ok: true, value: { censurado: true } };
}

/**
 * Levanta la censura y borra el motivo.
 *
 * El motivo se va con la marca a propósito: un motivo sin censura sería
 * una acusación colgada sin consecuencia, y lo que el autor tiene que
 * ver a partir de acá es su pieza normal.
 */
export async function levantarCensura(
  tipo: unknown,
  clave: unknown,
  moderadorEmail?: string | null
): Promise<WriteResult<{ levantada: true }>> {
  if (!moderadorEmail || !(await isModerator(moderadorEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador levanta una censura" };
  }
  if (!esTipoContenido(tipo)) {
    return { ok: false, status: 400, error: "Ese tipo de contenido no existe" };
  }
  const o = OBJETIVOS[tipo];
  const id = normalizarClave(o.tipoClave, clave);
  if (id === null) return { ok: false, status: 404, error: "No encontré eso" };

  const filas = await sql(
    `UPDATE ${o.tabla}
     SET censored_at = NULL, censored_by = NULL, censor_reason = NULL
     WHERE ${o.clave} = $1 AND censored_at IS NOT NULL
     RETURNING ${o.clave}`,
    [id]
  );
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Eso no está censurado" };
  }
  return { ok: true, value: { levantada: true } };
}

/** El valor de la clave, con el tipo que corresponde, o null si no sirve. */
function normalizarClave(tipoClave: "text" | "int", v: unknown): string | number | null {
  if (tipoClave === "int") {
    const n = typeof v === "number" ? v : Number(limpiarTexto(v));
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const s = limpiarTexto(v);
  return s === "" ? null : s;
}

/* ===================================================================
 * BAN
 * =================================================================== */

/**
 * Banea una CUENTA, no un perfil.
 *
 * Una persona puede tener perfil de artista, un colectivo y un venue;
 * banear el perfil la deja entrar y rehacerlo. Lo que se cierra es la
 * puerta, y eso vive en user_profiles.
 *
 * NO SE BORRA NADA. El contenido se oculta —derivado del ban— y vuelve
 * entero si el ban se levanta. Borrar en cascada castigaría además a
 * gente que no hizo nada: los miembros del colectivo, los que compraron
 * boletas.
 *
 * El colectivo que era suyo queda SIN DUEÑO: owner_email a NULL en el
 * mismo movimiento. Si quedara a nombre de la cuenta baneada, nadie
 * podría administrarlo nunca más —el dueño no puede entrar— y sus
 * miembros quedarían encerrados en un colectivo que no responde.
 */
export async function banearCuenta(
  emailCrudo: unknown,
  motivoCrudo: unknown,
  moderadorEmail?: string | null
): Promise<WriteResult<{ baneada: true; colectivosSinDueno: string[] }>> {
  if (!moderadorEmail || !(await isModerator(moderadorEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador banea cuentas" };
  }
  const email = limpiarTexto(emailCrudo).toLowerCase();
  if (!email) return { ok: false, status: 400, error: "Falta la cuenta" };

  const v = validarMotivo(motivoCrudo);
  if ("error" in v) return { ok: false, status: 400, error: v.error };

  /**
   * NADIE SE BANEA A SÍ MISMO, NI BANEA A OTRO MODERADOR.
   *
   * Lo primero es un pie en el pie: la cuenta queda afuera y el panel
   * pierde a quien lo atendía. Lo segundo es peor — dos moderadores
   * enojados se pueden dejar afuera mutuamente en dos clicks, y el que
   * apriete primero gana. Sacarle el rol a un moderador es una decisión
   * de ROLES, que es de un SUPER_ADMIN, y ahí sí hay una sola persona
   * decidiendo.
   */
  if (email === moderadorEmail.toLowerCase()) {
    return { ok: false, status: 400, error: "No te podés banear a vos mismo" };
  }
  if (await isModerator(email)) {
    return {
      ok: false,
      status: 409,
      error:
        "Esa cuenta modera. Sacale el rol desde ROLES —que es de un SUPER_ADMIN— antes de banearla.",
    };
  }

  const [cuenta] = await sql`SELECT email, banned_at FROM user_profiles WHERE lower(email) = ${email}`;
  if (!cuenta) return { ok: false, status: 404, error: "Esa cuenta no existe" };
  if (cuenta.banned_at) return { ok: false, status: 409, error: "Esa cuenta ya está baneada" };

  /**
   * Las dos escrituras van JUNTAS en una transacción.
   *
   * Entre el ban y el desenganche de los colectivos hay una ventana real
   * —cada sql del driver HTTP es su propio request— y si la segunda
   * falla queda una cuenta baneada dueña de un colectivo que nadie puede
   * administrar: el peor de los dos estados, y el que nadie va a ir a
   * buscar porque el ban "funcionó".
   */
  const pasos = await sql.transaction([
    sql`
      UPDATE user_profiles
      SET banned_at = now(), banned_by = ${moderadorEmail}, ban_reason = ${v.motivo}
      WHERE lower(email) = ${email} AND banned_at IS NULL
      RETURNING email
    `,
    sql`
      UPDATE collectives SET owner_email = NULL
      WHERE lower(owner_email) = ${email}
      RETURNING slug
    `,
  ]);

  const baneadas = Array.isArray(pasos[0]) ? (pasos[0] as Array<{ email: string }>) : [];
  if (baneadas.length === 0) {
    return { ok: false, status: 409, error: "Alguien la baneó mientras tanto" };
  }
  const sueltos = Array.isArray(pasos[1]) ? (pasos[1] as Array<{ slug: string }>) : [];

  return {
    ok: true,
    value: { baneada: true, colectivosSinDueno: sueltos.map((c) => c.slug) },
  };
}

/**
 * Levanta el ban.
 *
 * El contenido vuelve solo, porque nunca se marcó: las lecturas dejan de
 * ver el ban y con eso alcanza.
 *
 * LOS COLECTIVOS NO VUELVEN. Quedaron sin dueño y así se quedan: devolver
 * la propiedad automáticamente pisaría a quien se la hayan dado mientras
 * tanto, y un colectivo tiene un solo owner_email. Que lo vuelva a
 * recibir es una decisión de alguien, no un efecto secundario de esta.
 * El resultado lo dice, para que quien levanta el ban lo sepa en el
 * momento y no lo descubra por un reclamo.
 */
export async function levantarBan(
  emailCrudo: unknown,
  moderadorEmail?: string | null
): Promise<WriteResult<{ levantado: true }>> {
  if (!moderadorEmail || !(await isModerator(moderadorEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador levanta un ban" };
  }
  const email = limpiarTexto(emailCrudo).toLowerCase();
  if (!email) return { ok: false, status: 400, error: "Falta la cuenta" };

  const filas = await sql`
    UPDATE user_profiles
    SET banned_at = NULL, banned_by = NULL, ban_reason = NULL
    WHERE lower(email) = ${email} AND banned_at IS NOT NULL
    RETURNING email
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Esa cuenta no está baneada" };
  }
  return { ok: true, value: { levantado: true } };
}
