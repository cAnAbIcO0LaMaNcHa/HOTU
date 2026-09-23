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

/* ===================================================================
 * REASIGNAR EL DUEÑO DE UN PERFIL (§8, pieza 1)
 *
 * El caso que lo pide: los perfiles que nacieron sin dueño y a los que
 * el paso 1 de la tanda 5 les creó una cuenta a su nombre, SIN
 * contraseña. Esas cuentas existen, administran perfiles, y nadie puede
 * entrar en ellas. Cuando la persona de verdad aparezca, esto es lo que
 * la pone al frente de lo suyo.
 *
 * ============================================================
 * LA VERIFICACIÓN ES HUMANA, Y NO SE PUEDE FINGIR OTRA COSA
 * ============================================================
 *
 * No hay forma automatizable de comprobar que alguien es quien dice: el
 * repo no tiene transporte de correo, los emails de esas cuentas son de
 * un dominio que no existe, y de 17 artistas solo 3 tienen
 * contact_email —los tres falsos— y ninguno tiene redes cargadas. La
 * plataforma no sabe cómo contactar a nadie.
 *
 * Entonces esto NO verifica: REGISTRA la decisión de quien verificó por
 * fuera. Por eso el motivo es obligatorio y por eso tiene que decir CÓMO
 * se comprobó. "Me escribió por el Instagram de HOTU y mandó una foto
 * del set" es lo que alguien tiene que poder leer dentro de seis meses.
 * =================================================================== */

/** Todo lo que una cuenta administra hoy. */
export type LoQueAdministra = {
  artistas: Array<{ slug: string; name: string }>;
  colectivos: Array<{ slug: string; name: string; esVenue: boolean }>;
};

async function administradoPor(email: string): Promise<LoQueAdministra> {
  const [artistas, colectivos] = await Promise.all([
    sql`SELECT slug, name FROM artists WHERE lower(owner_email) = lower(${email}) ORDER BY slug`,
    sql`SELECT slug, name, entity_kind FROM collectives WHERE lower(owner_email) = lower(${email}) ORDER BY slug`,
  ]);
  return {
    artistas: artistas.map((a) => ({ slug: a.slug as string, name: a.name as string })),
    colectivos: colectivos.map((c) => ({
      slug: c.slug as string,
      name: c.name as string,
      esVenue: (c.entity_kind as string) === "venue",
    })),
  };
}

/**
 * Qué administra la cuenta que hoy es dueña de este perfil.
 *
 * Se consulta ANTES de mover nada, para que el moderador vea en pantalla
 * qué se va a llevar el traspaso. Un botón que mueve más de lo que dice
 * es un botón que se aprieta una sola vez.
 */
export async function queAdministraElDuenoDe(
  tipo: "artist" | "collective",
  slug: string
): Promise<{ dueno: string | null; administra: LoQueAdministra } | null> {
  const tabla = tipo === "artist" ? "artists" : "collectives";
  const [fila] = await sql(`SELECT owner_email FROM ${tabla} WHERE slug = $1`, [limpiarTexto(slug)]);
  if (!fila) return null;
  const dueno = (fila.owner_email as string | null) ?? null;
  if (!dueno) return { dueno: null, administra: { artistas: [], colectivos: [] } };
  return { dueno, administra: await administradoPor(dueno) };
}

/**
 * Pasa TODO lo que administra el dueño actual de un perfil a otra cuenta.
 *
 * ============================================================
 * SE LLEVA TODO, NO UN PERFIL SUELTO
 * ============================================================
 *
 * Siete de estas cuentas administran un artista Y un colectivo. Mover
 * solo el artista dejaría el colectivo a nombre de una cuenta en la que
 * nadie puede entrar: el problema exacto que esto viene a resolver,
 * reproducido a la mitad.
 *
 * ============================================================
 * LA CUENTA VACÍA SE BORRA, PERO SOLO SI ES UN FANTASMA
 * ============================================================
 *
 * Un email deducible de la URL, sin contraseña y sin dueño, es una
 * puerta esperando a que alguien abra un flujo de recuperación.
 *
 * Pero el borrado exige que sea un fantasma de verdad: sin contraseña,
 * sin likes, sin pedidos, sin tiquetes y sin roles. Si esto se usa
 * alguna vez para traspasar entre dos personas reales, la cuenta de
 * origen NO se toca — su dueño la sigue usando para todo lo demás.
 */
export async function reasignarDueno(
  tipo: unknown,
  slug: unknown,
  emailDestinoCrudo: unknown,
  motivoCrudo: unknown,
  moderadorEmail?: string | null
): Promise<
  WriteResult<{
    movidos: LoQueAdministra;
    desde: string | null;
    hacia: string;
    cuentaBorrada: boolean;
  }>
> {
  if (!moderadorEmail || !(await isModerator(moderadorEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador reasigna un perfil" };
  }
  if (tipo !== "artist" && tipo !== "collective") {
    return { ok: false, status: 400, error: "tipo tiene que ser 'artist' o 'collective'" };
  }
  const v = validarMotivo(motivoCrudo);
  if ("error" in v) return { ok: false, status: 400, error: v.error };

  const clave = limpiarTexto(slug);
  if (!clave) return { ok: false, status: 400, error: "Falta el perfil" };
  const destino = limpiarTexto(emailDestinoCrudo).toLowerCase();
  if (!destino) return { ok: false, status: 400, error: "Falta la cuenta que lo va a recibir" };

  const actual = await queAdministraElDuenoDe(tipo, clave);
  if (!actual) return { ok: false, status: 404, error: "No encontré ese perfil" };

  /**
   * LA CUENTA DESTINO TIENE QUE EXISTIR YA.
   *
   * Crearla desde acá sería el admin dando de alta cuentas ajenas, que
   * es volver al CMS por otra puerta. La persona se registra con su
   * email real —que además es lo único que prueba que controla ese
   * correo— y recién ahí se le entrega el perfil.
   */
  const [cuenta] = await sql`
    SELECT email, banned_at FROM user_profiles WHERE lower(email) = ${destino}
  `;
  if (!cuenta) {
    return {
      ok: false,
      status: 404,
      error:
        "Esa cuenta no existe todavía. Pedile que se registre con su email real y " +
        "volvé a intentarlo: registrarse es lo único que prueba que controla ese correo.",
    };
  }
  if (cuenta.banned_at) {
    return { ok: false, status: 409, error: "Esa cuenta está baneada" };
  }
  if (actual.dueno && actual.dueno.toLowerCase() === destino) {
    return { ok: false, status: 409, error: "Ese perfil ya es de esa cuenta" };
  }

  const origen = actual.dueno;

  /**
   * ¿La cuenta de origen es un fantasma que se puede borrar?
   *
   * Se pregunta ANTES de mover, con la cuenta todavía entera. Después
   * habría que distinguir "no tiene nada porque acabamos de vaciarla" de
   * "no tenía nada", que es la misma pregunta con más pasos.
   */
  let esFantasma = false;
  if (origen) {
    const [f] = await sql`
      SELECT
        (SELECT password_hash IS NULL FROM user_profiles WHERE lower(email) = lower(${origen})) AS sin_pass,
        (SELECT COUNT(*)::int FROM artist_likes WHERE lower(user_email) = lower(${origen})) AS likes_a,
        (SELECT COUNT(*)::int FROM collective_likes WHERE lower(user_email) = lower(${origen})) AS likes_c,
        (SELECT COUNT(*)::int FROM orders WHERE lower(user_email) = lower(${origen})) AS pedidos,
        (SELECT COUNT(*)::int FROM tickets WHERE lower(user_email) = lower(${origen})) AS boletas,
        (SELECT COUNT(*)::int FROM user_roles WHERE lower(email) = lower(${origen})) AS roles
    `;
    esFantasma =
      f.sin_pass === true &&
      Number(f.likes_a) === 0 &&
      Number(f.likes_c) === 0 &&
      Number(f.pedidos) === 0 &&
      Number(f.boletas) === 0 &&
      Number(f.roles) === 0;
  }

  const movidos = origen
    ? actual.administra
    : tipo === "artist"
      ? { artistas: [{ slug: clave, name: clave }], colectivos: [] }
      : { artistas: [], colectivos: [{ slug: clave, name: clave, esVenue: false }] };

  /**
   * Los pasos van JUNTOS.
   *
   * Entre mover los artistas y mover los colectivos hay una ventana real
   * —cada sql del driver HTTP es su propio request— y si el segundo
   * falla queda la mitad traspasada: el DJ entra a lo suyo y su
   * colectivo sigue a nombre de una cuenta muerta, que es peor que no
   * haber empezado.
   *
   * El borrado va AL FINAL y no antes: el FK de owner_email es ON DELETE
   * SET NULL, así que borrar primero dejaría los perfiles sin dueño y el
   * traspaso no movería nada.
   */
  const pasos = [
    origen
      ? sql`UPDATE artists SET owner_email = ${cuenta.email} WHERE lower(owner_email) = lower(${origen})`
      : sql`UPDATE artists SET owner_email = ${cuenta.email} WHERE slug = ${clave} AND owner_email IS NULL`,
    origen
      ? sql`UPDATE collectives SET owner_email = ${cuenta.email} WHERE lower(owner_email) = lower(${origen})`
      : sql`UPDATE collectives SET owner_email = ${cuenta.email} WHERE slug = ${clave} AND owner_email IS NULL`,
  ];
  if (origen && esFantasma) {
    pasos.push(sql`DELETE FROM user_profiles WHERE lower(email) = lower(${origen})`);
  }
  await sql.transaction(pasos);

  return {
    ok: true,
    value: {
      movidos,
      desde: origen,
      hacia: cuenta.email as string,
      cuentaBorrada: Boolean(origen && esFantasma),
    },
  };
}
