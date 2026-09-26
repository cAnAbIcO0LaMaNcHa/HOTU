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
 * fiestas. Lo puntual que esté mal se censura de a uno, que es para lo
 * que existe la censura.
 *
 * ============================================================
 * Y EL BAN NO TOCA LA PROPIEDAD. NINGUNA.
 * ============================================================
 *
 * Antes ponía owner_email en NULL en los colectivos de la cuenta, y
 * levantar el ban no los devolvía. Eso contradecía las dos cosas que el
 * ban promete: que es REVERSIBLE y que NO BORRA DATOS. Alguien baneado
 * por error volvía sin sus colectivos, y recuperarlos dependía de que un
 * moderador se acordara de a quién eran.
 *
 * Ahora el ban bloquea a la PERSONA —no entra, no publica, no compra— y
 * deja todo lo demás intacto. Al levantarlo, queda como estaba.
 *
 * El colectivo de una cuenta baneada queda congelado: nadie puede
 * publicar a su nombre, porque su dueño no puede entrar. Si hay que
 * moverlo de verdad, eso es un traspaso de moderación, que pide motivo y
 * deja rastro.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { isModerator } from "./roles-check";
import { actividadDeCuenta, esCuentaFantasma } from "./accounts";
import { limpiarTexto, recortar } from "./texto";
import { revocarCesionesAbiertas, type WriteResult } from "./collectives-write";

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
): Promise<WriteResult<{ baneada: true }>> {
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
   * UNA sola escritura: la marca en la cuenta. Nada más.
   *
   * Y el WHERE repite banned_at IS NULL para que dos moderadores que
   * aprieten a la vez no pisen el motivo del primero.
   */
  const baneadas = await sql`
    UPDATE user_profiles
    SET banned_at = now(), banned_by = ${moderadorEmail}, ban_reason = ${v.motivo}
    WHERE lower(email) = ${email} AND banned_at IS NULL
    RETURNING email
  `;
  if (baneadas.length === 0) {
    return { ok: false, status: 409, error: "Alguien la baneó mientras tanto" };
  }

  return { ok: true, value: { baneada: true } };
}

/**
 * Levanta el ban.
 *
 * TODO vuelve solo, porque nada se marcó ni se movió: las lecturas dejan
 * de ver el ban y con eso alcanza. La cuenta sigue siendo dueña de
 * exactamente lo mismo que antes.
 *
 * Eso es lo que hace que el ban sea de verdad reversible. Mientras el ban
 * desenganchaba los colectivos, levantarlo devolvía a una persona
 * distinta de la que se había baneado.
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

/**
 * CUÁNTO SE LLEVA UN TRASPASO, y quién lo decide.
 *
 *   todo           — de una cuenta FANTASMA. Nadie la usa ni puede
 *                    usarla, así que dejarle la mitad solo produce otro
 *                    perfil administrado por una cuenta muerta: el
 *                    problema que el traspaso viene a resolver, a medias.
 *   solo_nombrado  — de una cuenta REAL. Mover su perfil de artista
 *                    porque alguien le traspasó su colectivo es tomarle
 *                    algo que nadie pidió. Casi nunca es la intención, y
 *                    el formulario que lo mostraba no alcanzaba: nadie
 *                    lee un recuadro cuando cree saber lo que va a pasar.
 *
 * LO DECIDE EL SERVIDOR, mirando la cuenta. El formulario manda cuál
 * creyó ver para que la escritura pueda rechazar si cambió en el medio,
 * pero no lo elige.
 */
export type ModoTraspaso = "todo" | "solo_nombrado";

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
): Promise<{
  dueno: string | null;
  administra: LoQueAdministra;
  modo: ModoTraspaso;
  /** Lo que se va a mover DE VERDAD, ya resuelto por el modo. */
  seMueve: LoQueAdministra;
  /** Y lo que se queda con el dueño actual. Es lo que hay que leer. */
  seQueda: LoQueAdministra;
} | null> {
  const tabla = tipo === "artist" ? "artists" : "collectives";
  const clave = limpiarTexto(slug);
  const [fila] = await sql(
    `SELECT owner_email, name FROM ${tabla} WHERE slug = $1`,
    [clave]
  );
  if (!fila) return null;
  const dueno = (fila.owner_email as string | null) ?? null;
  const nombre = (fila.name as string) ?? clave;

  const soloEste: LoQueAdministra =
    tipo === "artist"
      ? { artistas: [{ slug: clave, name: nombre }], colectivos: [] }
      : { artistas: [], colectivos: [{ slug: clave, name: nombre, esVenue: false }] };

  // Sin dueño no hay nada más que mover que el perfil nombrado, y no hay
  // cuenta que clasificar.
  if (!dueno) {
    return {
      dueno: null,
      administra: { artistas: [], colectivos: [] },
      modo: "solo_nombrado",
      seMueve: soloEste,
      seQueda: { artistas: [], colectivos: [] },
    };
  }

  const administra = await administradoPor(dueno);
  const actividad = await actividadDeCuenta(dueno);
  const modo: ModoTraspaso =
    actividad && esCuentaFantasma(actividad) ? "todo" : "solo_nombrado";

  if (modo === "todo") {
    return { dueno, administra, modo, seMueve: administra, seQueda: { artistas: [], colectivos: [] } };
  }
  return {
    dueno,
    administra,
    modo,
    seMueve: soloEste,
    seQueda: {
      artistas: administra.artistas.filter((a) => !(tipo === "artist" && a.slug === clave)),
      colectivos: administra.colectivos.filter((k) => !(tipo === "collective" && k.slug === clave)),
    },
  };
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
  moderadorEmail?: string | null,
  /**
   * El modo que el formulario MOSTRÓ. No lo elige: lo declara, para que
   * esta función pueda negarse si entre la vista previa y el confirmar la
   * cuenta cambió de clasificación —alguien le puso contraseña, o le
   * llegó un pedido—. Sin esto, el moderador aprieta sobre una promesa
   * ("solo se mueve el colectivo") y se ejecuta otra.
   *
   * Si no se manda, no se comprueba nada: la app puede llamar sin haber
   * mostrado una previa.
   */
  modoEsperado?: ModoTraspaso
): Promise<
  WriteResult<{
    movidos: LoQueAdministra;
    seQueda: LoQueAdministra;
    modo: ModoTraspaso;
    desde: string | null;
    hacia: string;
    cuentaBorrada: boolean;
    /** Cesiones abiertas que este traspaso cerró. */
    cesionesCerradas: number;
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
   * EL MODO SE RECALCULA ACÁ, con la cuenta como está AHORA.
   *
   * La vista previa calculó uno hace unos segundos; este es el que vale.
   * Se relee SOLO la actividad de la cuenta —una consulta— y no el árbol
   * entero: el árbol ya lo tenemos, y lo único que puede haber cambiado
   * la clasificación es la cuenta.
   * Si no coinciden, no se ejecuta ninguno de los dos: se devuelve un
   * error que dice que mire de nuevo. Ejecutar "el modo viejo" porque el
   * formulario lo pidió sería dejar que la UI decida cuánto se mueve, y
   * la UI nunca es la guarda.
   */
  const actividadAhora = origen ? await actividadDeCuenta(origen) : null;
  const modoAhora: ModoTraspaso =
    origen && actividadAhora && esCuentaFantasma(actividadAhora) ? "todo" : "solo_nombrado";
  const recalculado = {
    modo: modoAhora,
    seMueve: modoAhora === "todo" ? actual.administra : actual.seMueve,
    seQueda: modoAhora === "todo" ? { artistas: [], colectivos: [] } : actual.seQueda,
  };
  if (modoEsperado && modoEsperado !== recalculado.modo) {
    return {
      ok: false,
      status: 409,
      error:
        "La cuenta cambió desde la vista previa, revisá de nuevo. " +
        (recalculado.modo === "todo"
          ? "Ahora figura sin actividad, así que el traspaso se llevaría todo."
          : "Ahora figura activa, así que el traspaso movería solo el perfil que nombraste."),
    };
  }
  const modo = recalculado.modo;
  const esFantasma = modo === "todo";

  const movidos = recalculado.seMueve;

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
  /**
   * En modo 'todo' se mueve por DUEÑO; en 'solo_nombrado', por SLUG.
   *
   * Los dos WHERE nombran también el origen esperado —el dueño, o
   * IS NULL— así que si alguien cambió la propiedad entre el recálculo y
   * esto, el UPDATE no toca nada en vez de pisar la decisión de otro.
   */
  const pasos =
    modo === "todo"
      ? [
          sql`UPDATE artists SET owner_email = ${cuenta.email} WHERE lower(owner_email) = lower(${origen})`,
          sql`UPDATE collectives SET owner_email = ${cuenta.email} WHERE lower(owner_email) = lower(${origen})`,
        ]
      : [
          tipo === "artist"
            ? sql`UPDATE artists SET owner_email = ${cuenta.email} WHERE slug = ${clave} AND (lower(owner_email) = lower(${origen ?? ""}) OR (owner_email IS NULL AND ${origen === null}))`
            : sql`SELECT 1`,
          tipo === "collective"
            ? sql`UPDATE collectives SET owner_email = ${cuenta.email} WHERE slug = ${clave} AND (lower(owner_email) = lower(${origen ?? ""}) OR (owner_email IS NULL AND ${origen === null}))`
            : sql`SELECT 1`,
        ];
  if (origen && esFantasma) {
    pasos.push(sql`DELETE FROM user_profiles WHERE lower(email) = lower(${origen})`);
  }
  await sql.transaction(pasos);

  /**
   * Y se cierran las cesiones que hubiera abiertas sobre lo que se movió.
   *
   * Sin esto queda una fila 'cesion' pendiente sobre un colectivo que ya
   * tiene otro dueño: el índice único la sigue contando como la cesión
   * abierta, y el dueño nuevo no podría cederlo nunca. No falla, BLOQUEA
   * — el modo de falla que el migration-reviewer encontró en el schema.
   *
   * Va DESPUÉS del traspaso y fuera de su transacción a propósito: si
   * esto fallara, lo que queda mal es una fila de registro, no la
   * propiedad. Al revés sería peor.
   */
  let cesionesCerradas = 0;
  for (const col of movidos.colectivos) {
    cesionesCerradas += await revocarCesionesAbiertas(col.slug);
  }

  /**
   * Y RECIÉN AHORA QUEDA EL RASTRO, que hasta hoy no quedaba en ninguna parte.
   *
   * kind='moderacion' existía en el CHECK de la tabla desde la migración
   * que la creó, con su exigencia de motivo, y NINGÚN write path lo
   * escribía. O sea que la acción más poderosa del panel —mover la
   * propiedad de un perfil, y en modo 'todo' de VARIOS a la vez— no
   * dejaba una fila que alguien pudiera revisar después. El vocabulario
   * lo anticipó y el código nunca lo usó.
   *
   * Una fila POR PERFIL movido, no una por traspaso: un modo 'todo' que
   * mueve un artista y dos colectivos son tres cambios de propiedad, y
   * mirar la historia de UN perfil tiene que devolver su cambio. Una fila
   * resumen no aparecería al consultar por slug.
   *
   * Va al final, fuera de la transacción del traspaso y sin poder
   * voltearlo: si el registro falla, lo que queda mal es el registro, no
   * la propiedad. Al revés sería peor. Por eso el catch no propaga — pero
   * avisa, porque un traspaso sin rastro es justamente lo que se está
   * arreglando.
   */
  try {
    const filas = [
      ...movidos.artistas.map((a) => ({ col: "artist_slug", slug: a.slug })),
      ...movidos.colectivos.map((c) => ({ col: "collective_slug", slug: c.slug })),
    ];
    for (const f of filas) {
      await sql(
        `INSERT INTO profile_ownership (${f.col}, kind, from_email, to_email, note, decided_by, accepted_at)
         VALUES ($1, 'moderacion', $2, $3, $4, $5, now())`,
        [f.slug, origen, cuenta.email as string, v.motivo, moderadorEmail]
      );
    }
  } catch (err) {
    console.error("[traspaso] el traspaso se aplicó pero NO quedó registrado:", err);
  }

  return {
    ok: true,
    value: {
      movidos,
      seQueda: recalculado.seQueda,
      modo,
      desde: origen,
      hacia: cuenta.email as string,
      cuentaBorrada: Boolean(origen && esFantasma),
      cesionesCerradas,
    },
  };
}
