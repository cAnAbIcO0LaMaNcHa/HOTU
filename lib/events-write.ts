/**
 * Publicar un evento desde una cuenta de la comunidad (tanda 5 §3).
 *
 * Hasta hoy los eventos solo nacían del admin, por Server Action, porque
 * no había otro camino. Este es el otro camino: lo publica el dueño del
 * colectivo o del venue que lo organiza, desde su panel.
 *
 * NO HAY COLA DE APROBACIÓN ACÁ, y es a propósito. La migración de este
 * paso le puso revisión a las NOTICIAS y no a los eventos: una fiesta
 * tiene fecha, y una cola de aprobación entre el anuncio y la puerta
 * convierte al admin en el cuello de botella de la agenda de la escena.
 * Un evento sale publicado y el admin lo censura si hace falta, que es
 * exactamente el rol que esta tanda le deja.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { isOwnBlobUrl } from "./blob";
import { canEditCollective, type WriteResult } from "./collectives-write";
import { resolverRolParaRegistro, sentenciaDeRegistro } from "./edit-log-write";
import { limpiarTexto, limpiarYRecortar, validarFecha } from "./texto";

const sql = neon(process.env.DATABASE_URL!);

/**
 * El distrito congelado, igual que en lib/news-write.ts.
 *
 * events.district es NOT NULL y NO tiene DEFAULT, así que omitirlo del
 * INSERT revienta. El sistema de distritos se está yendo y ponerle un
 * DEFAULT a una columna que se va a borrar es trabajo para deshacer.
 */
const DISTRITO_CONGELADO = "D00";

export type NuevoEvento = {
  /** El colectivo o venue que organiza. Decide también quién puede. */
  organizerSlug?: unknown;
  title?: unknown;
  /** YYYY-MM-DD. events.event_date es DATE: no lleva hora. */
  date?: unknown;
  /** Valor de un <input type="datetime-local">, o vacío. */
  endAt?: unknown;
  venue?: unknown;
  city?: unknown;
  lineup?: unknown;
  /** URL que devolvió /api/upload. */
  flyerUrl?: unknown;
  /**
   * Precio en taquilla, INFORMATIVO. Vacío o ausente = no dijo, y la página no
   * muestra nada. No participa de ningún cobro: la venta online está apagada
   * por VENTA_ONLINE y esto es un anuncio, no un precio de venta.
   */
  doorPriceCop?: unknown;
};

/**
 * Publica un evento a nombre de un colectivo o de un venue.
 *
 * Lo único que el cliente decide sobre permisos es a nombre de QUIÉN
 * publica; si puede o no lo resuelve canEditCollective contra la sesión,
 * que es la misma función que usan el panel y el editor de miembros.
 */
export async function createCommunityEvent(
  input: NuevoEvento,
  email?: string | null
): Promise<WriteResult<{ id: number; slugOrganizador: string }>> {
  if (!email) return { ok: false, status: 403, error: "Not signed in" };

  const organizerSlug = limpiarTexto(input.organizerSlug);
  if (!organizerSlug) {
    return { ok: false, status: 400, error: "Decí a nombre de quién lo publicás" };
  }

  const [org] = await sql`
    SELECT slug, name, sector, entity_kind, censored_at
    FROM collectives WHERE slug = ${organizerSlug}
  `;
  if (!org) return { ok: false, status: 404, error: "Ese colectivo no existe" };

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
  if (org.censored_at) {
    return {
      ok: false,
      status: 409,
      error:
        "Este perfil está bajado por moderación, así que no puede publicar nada nuevo. " +
        "El motivo está en tu panel. Cuando se resuelva, volvés a publicar.",
    };
  }

  if (!(await canEditCollective(organizerSlug, email))) {
    return {
      ok: false,
      status: 403,
      error: "Solo quien administra ese colectivo publica a su nombre",
    };
  }

  // limpiarYRecortar y no .slice: un emoji al final del tope dejaba
  // medio carácter y el driver devolvía un 500 que no nombraba el campo.
  const title = limpiarYRecortar(input.title, 160);
  if (title.length < 3) {
    return { ok: false, status: 400, error: "El evento necesita un nombre de al menos 3 letras" };
  }

  /**
   * La fecha, con tope de años para ADELANTE.
   *
   * Una fiesta en el 9999 no es un error de tipeo: es la primera de la
   * agenda para siempre, igual que el DESTACADO que este formulario no
   * ofrece justamente por eso. Cinco años alcanza para cualquier cosa
   * que alguien esté anunciando de verdad.
   */
  const f = validarFecha(input.date, { maxAnios: 5, siVacia: "error" });
  if ("error" in f) return { ok: false, status: 400, error: f.error };
  const date = f.date;

  /**
   * end_at opcional. Mismo tratamiento que el admin: llega el valor
   * crudo de un datetime-local y se normaliza a ISO.
   *
   * La comparación es por DÍA, no por instante, y no puede ser de otra
   * forma: event_date es un DATE, así que el evento no tiene hora de
   * inicio contra la cual comparar. Lo único que se puede afirmar es que
   * un evento no termina ANTES del día en que pasa.
   */
  const endRaw = limpiarTexto(input.endAt);
  let endAt: string | null = null;
  if (endRaw) {
    const d = new Date(endRaw);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, status: 400, error: "La hora de cierre no se entiende" };
    }
    // El año PRIMERO. Un año extendido (+275760) serializa como
    // "+275760-09-13" y la comparación de strings de abajo daba
    // "anterior al día del evento" — un 400 con el motivo equivocado,
    // que manda a corregir lo que no está mal.
    const anioFin = d.getUTCFullYear();
    if (anioFin < 2000 || anioFin > new Date().getUTCFullYear() + 5) {
      return { ok: false, status: 400, error: "El año de la hora de cierre no es válido" };
    }
    if (d.toISOString().slice(0, 10) < date) {
      return {
        ok: false,
        status: 400,
        error: "La hora de cierre cae antes del día del evento",
      };
    }
    endAt = d.toISOString();
  }

  /**
   * EL VENUE SE DERIVA CUANDO QUIEN PUBLICA **ES** EL VENUE.
   *
   * events.venue es NOT NULL y es el lugar donde pasa la fiesta. Si el
   * que publica es un venue, ese lugar es él: pedirle que lo teclee es
   * pedirle que repita su propio nombre, y lo va a escribir distinto de
   * como está en su página la mitad de las veces.
   *
   * Un colectivo sí tiene que decirlo: toca en lugares distintos.
   */
  const esVenue = (org.entity_kind as string) === "venue";
  const venue = limpiarYRecortar(input.venue, 160) || (esVenue ? String(org.name) : "");
  if (!venue) {
    return { ok: false, status: 400, error: "Decí en qué lugar es" };
  }

  // La ciudad cae al sector del colectivo, que es donde createCollective
  // sembró la del fundador. Es un dato que el que publica ya dio una vez.
  const city = limpiarYRecortar(input.city, 120) || limpiarYRecortar(org.sector, 120);
  if (!city) {
    return { ok: false, status: 400, error: "Decí en qué ciudad es" };
  }

  // lineup es NOT NULL y hoy es texto libre: el importador de
  // event_lineup lo resuelve después contra artistas y colectivos.
  const lineup = limpiarYRecortar(input.lineup, 2000);

  /**
   * El flyer TIENE QUE SER UNO NUESTRO.
   *
   * isOwnBlobUrl es la misma guarda que usa el borrado de imágenes del
   * EPK. Sin ella, flyerUrl es un campo donde cualquiera con una cuenta
   * pega la URL que quiera y HOTU la sirve desde su propia página: un
   * host ajeno que mide quién abre la agenda, o que cambia la imagen por
   * otra cosa después de que un moderador la miró.
   */
  const flyerRaw = limpiarTexto(input.flyerUrl);
  if (flyerRaw && !isOwnBlobUrl(flyerRaw)) {
    return {
      ok: false,
      status: 400,
      error: "El flyer tiene que subirse acá, no enlazarse de otro lado",
    };
  }
  const flyerUrl = flyerRaw || null;

  const precio = validarPrecioTaquilla(input.doorPriceCop);
  if (!precio.ok) return { ok: false, status: 400, error: precio.error };

  /**
   * El rol ANTES de escribir: nada se escribe sin registro, y resolverlo primero
   * es lo que hace que el corte sea limpio en vez de dejar el evento creado y el
   * log vacío.
   */
  const rol = await resolverRolParaRegistro(organizerSlug, email);
  if (!rol) {
    return {
      ok: false,
      status: 403,
      error:
        "No pude determinar con qué rol registrar la creación de este evento, así que no lo " +
        "publiqué. Nada se escribe sin registro.",
    };
  }

  /**
   * ============================================================
   * UN SOLO STATEMENT CON CTE, Y NO UNA TRANSACCIÓN DE DOS
   * ============================================================
   *
   * Los otros caminos meten el dato y el registro en un sql.transaction, pero acá
   * no se puede: el registro necesita el ID QUE EL INSERT DEVUELVE, y las
   * sentencias de una transacción se arman antes de ejecutarse, así que ninguna
   * puede leer el resultado de la anterior.
   *
   * Un CTE que modifica datos resuelve las dos cosas: Postgres garantiza que cada
   * uno se ejecuta exactamente una vez y hasta el final, independientemente de si
   * la consulta principal lee su salida — y al ser UNA sentencia, la atomicidad no
   * hay ni que pedirla.
   *
   * La alternativa era crear el evento, intentar el log, y borrar el evento si el
   * log falla. Eso es una compensación que también puede fallar, y entonces queda
   * el evento sin registro, que es exactamente lo que la regla prohíbe.
   */
  const [fila] = await sql`
    WITH nuevo AS (
      INSERT INTO events
        (event_date, end_at, flyer_url, city, venue, title, lineup, organizer_slug,
         door_price_cop,
         district, scope, country_code, language, status, featured, priority_at)
      VALUES
        (${date}, ${endAt}, ${flyerUrl}, ${city}, ${venue},
         ${title}, ${lineup}, ${organizerSlug},
         ${precio.valor},
         ${DISTRITO_CONGELADO}, 'country', 'COL', 'es', 'published', false, NULL)
      RETURNING id
    ), registro AS (
      INSERT INTO edit_log
        (actor_email, actor_rol, collective_slug, entidad, entidad_id, accion, detalle)
      SELECT ${email}, ${rol}, ${organizerSlug}, 'event', nuevo.id::text, 'crear', NULL
      FROM nuevo
    )
    SELECT id FROM nuevo
  `;

  return { ok: true, value: { id: Number(fila.id), slugOrganizador: organizerSlug } };
}

/* ===================================================================
 * CORREGIR Y BAJAR UN EVENTO PROPIO (tanda 5 §4)
 *
 * Esto no existía, y su ausencia era un agujero: la comunidad podía
 * publicar una fiesta y no podía arreglarle la fecha. Antes lo corregía
 * el admin; desde que el admin solo modera, si esto no existe el evento
 * queda inmutable para siempre y el sitio termina peor que antes.
 * =================================================================== */

/**
 * De quién es un evento, si es de alguien.
 *
 * organizer_slug NULL significa que no es de nadie que pueda entrar por
 * acá: son los eventos que cargó el admin cuando era un CMS. No tienen
 * dueño y este camino no se los inventa.
 */
async function cargarEventoPropio(
  id: number,
  email?: string | null
): Promise<
  | { ok: true; organizador: string; censurado: boolean }
  | { ok: false; status: 403 | 404; error: string }
> {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, status: 404, error: "No encontré ese evento" };
  }
  const [e] = await sql`SELECT organizer_slug, censored_at FROM events WHERE id = ${id}`;
  if (!e || !e.organizer_slug) {
    return { ok: false, status: 404, error: "No encontré ese evento" };
  }
  const organizador = e.organizer_slug as string;
  if (!(await canEditCollective(organizador, email))) {
    return { ok: false, status: 403, error: "Ese evento no es tuyo" };
  }
  return { ok: true, organizador, censurado: e.censored_at != null };
}

/**
 * EL PRECIO EN TAQUILLA, y la validación vive acá y no en la ruta porque los
 * dos caminos —crear y editar— tienen que rechazar lo mismo. Duplicarla es
 * cómo se desincronizan.
 *
 * Devuelve null para "no dijo precio", que NO es lo mismo que 0: 0 es un evento
 * gratuito que alguien decidió anunciar, y null es que no dijo nada y la página
 * no habla por él. Por eso el vacío NO cae en 0.
 *
 * NO HAY TOPE MÁXIMO, y es una decisión y no un olvido: el precio es del
 * organizador. Un tope sería la plataforma opinando sobre cuánto puede costar
 * entrar a una fiesta ajena. Un número absurdo se ve en la página y lo corrige
 * quien lo escribió; un tope que rechaza un precio legítimo no lo corrige nadie,
 * porque el organizador no sabe que existe.
 */
function validarPrecioTaquilla(
  crudo: unknown
): { ok: true; valor: number | null } | { ok: false; error: string } {
  if (crudo === undefined || crudo === null) return { ok: true, valor: null };
  const texto = String(crudo).trim();
  if (texto === "") return { ok: true, valor: null };

  // Se aceptan los puntos y espacios con que se escribe la plata acá —35.000,
  // 35 000— porque el formulario los muestra así y pedirle al organizador que
  // los saque es pedirle que escriba distinto de como lee.
  const limpio = texto.replace(/[.\s]/g, "");
  if (!/^\d+$/.test(limpio)) {
    return { ok: false, error: "El precio en taquilla tiene que ser un número en pesos, sin centavos" };
  }
  const n = Number(limpio);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, error: "El precio en taquilla tiene que ser un número en pesos, sin centavos" };
  }
  return { ok: true, valor: n };
}

export type ParcheEvento = {
  title?: unknown;
  date?: unknown;
  endAt?: unknown;
  venue?: unknown;
  city?: unknown;
  lineup?: unknown;
  flyerUrl?: unknown;
  doorPriceCop?: unknown;
};

/**
 * Corrige un evento propio.
 *
 * SE PUEDE EDITAR AUNQUE ESTÉ CENSURADO, y es a propósito: la censura
 * trae un motivo, y el motivo suele ser algo que se arregla. Editar no
 * lo devuelve al sitio —eso solo lo hace un moderador—, así que no hay
 * nada que esquivar. Es la diferencia con una noticia aprobada, donde
 * editar después SÍ saltearía la revisión.
 *
 * Una clave ausente es "dejalo como está". Las que llegan se validan
 * con las mismas reglas que al publicar: el formulario es presentación,
 * y la app va a llamar al mismo lib.
 */
export async function updateCommunityEvent(
  id: number,
  patch: ParcheEvento,
  email?: string | null
): Promise<WriteResult<{ id: number }>> {
  const propio = await cargarEventoPropio(id, email);
  if (!propio.ok) return propio;

  const [actual] = await sql`
    SELECT event_date::text AS d, venue, city, title, lineup, flyer_url, end_at, door_price_cop
    FROM events WHERE id = ${id}
  `;

  const title = patch.title === undefined ? String(actual.title) : limpiarYRecortar(patch.title, 160);
  if (title.length < 3) {
    return { ok: false, status: 400, error: "El evento necesita un nombre de al menos 3 letras" };
  }
  const venue = patch.venue === undefined ? String(actual.venue) : limpiarYRecortar(patch.venue, 160);
  if (!venue) return { ok: false, status: 400, error: "Decí en qué lugar es" };
  const city = patch.city === undefined ? String(actual.city) : limpiarYRecortar(patch.city, 120);
  if (!city) return { ok: false, status: 400, error: "Decí en qué ciudad es" };
  const lineup =
    patch.lineup === undefined ? String(actual.lineup) : limpiarYRecortar(patch.lineup, 2000);

  // Igual que en las noticias: null y "" son "no la toques", no una
  // fecha nueva. El <input type="date"> manda "" solo.
  let date = String(actual.d);
  if (patch.date !== undefined && patch.date !== null && limpiarTexto(patch.date) !== "") {
    const f = validarFecha(patch.date, { maxAnios: 5, siVacia: "error" });
    if ("error" in f) return { ok: false, status: 400, error: f.error };
    date = f.date;
  }

  // Los dos opcionales se resuelven a su valor FINAL acá, en
  // JavaScript, y no con un COALESCE anidado en el SQL. Hay tres casos
  // —no lo toques, vacialo, ponele esto— y escribirlos como tres
  // asignaciones se lee; escribirlos como un CASE adentro de un
  // COALESCE se descifra.
  let endAt: string | null =
    actual.end_at ? new Date(actual.end_at as string).toISOString() : null;
  if (patch.endAt !== undefined) {
    const raw = limpiarTexto(patch.endAt);
    if (!raw) {
      endAt = null; // Vaciarlo a propósito sí se puede: es opcional.
    } else {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, status: 400, error: "La hora de cierre no se entiende" };
      }
      const anioFin = d.getUTCFullYear();
      if (anioFin < 2000 || anioFin > new Date().getUTCFullYear() + 5) {
        return { ok: false, status: 400, error: "El año de la hora de cierre no es válido" };
      }
      if (d.toISOString().slice(0, 10) < date) {
        return { ok: false, status: 400, error: "La hora de cierre cae antes del día del evento" };
      }
      endAt = d.toISOString();
    }
  }

  let flyerUrl: string | null = (actual.flyer_url as string | null) ?? null;
  if (patch.flyerUrl !== undefined) {
    const raw = limpiarTexto(patch.flyerUrl);
    if (raw && !isOwnBlobUrl(raw)) {
      return {
        ok: false,
        status: 400,
        error: "El flyer tiene que subirse acá, no enlazarse de otro lado",
      };
    }
    flyerUrl = raw || null;
  }

  /**
   * AUSENTE Y VACÍO SON COSAS DISTINTAS, igual que con endAt. Si la clave no
   * viene, el precio queda como estaba —un formulario que muestra solo algunos
   * campos no puede borrar los que no muestra—. Si viene vacía, se BORRA a
   * propósito: así el organizador puede retirar un precio que ya no aplica.
   */
  let doorPrice: number | null = (actual.door_price_cop as number | null) ?? null;
  if (patch.doorPriceCop !== undefined) {
    const v = validarPrecioTaquilla(patch.doorPriceCop);
    if (!v.ok) return { ok: false, status: 400, error: v.error };
    doorPrice = v.valor;
  }

  const rol = await resolverRolParaRegistro(propio.organizador, email!);
  if (!rol) {
    return {
      ok: false,
      status: 403,
      error:
        "No pude determinar con qué rol registrar esta edición, así que no la apliqué. " +
        "Nada se escribe sin registro.",
    };
  }

  /**
   * El dato y el registro en una transacción. Acá sí alcanza —a diferencia de
   * crear— porque el id ya se conoce y ninguna sentencia necesita leer el
   * resultado de la otra.
   *
   * Los campos que se listan son los que este UPDATE toca SIEMPRE. door_price_cop
   * queda afuera de la lista a propósito: el UPDATE lo escribe con su valor
   * anterior cuando el patch no lo trae, así que anunciarlo como cambiado sería
   * decir que alguien lo tocó cuando no.
   */
  await sql.transaction([
    sql`
      UPDATE events SET
        title = ${title}, event_date = ${date}, venue = ${venue}, city = ${city}, lineup = ${lineup},
        end_at = ${endAt}, flyer_url = ${flyerUrl}, door_price_cop = ${doorPrice}
      WHERE id = ${id}
    `,
    sentenciaDeRegistro(rol, {
      collectiveSlug: propio.organizador,
      actorEmail: email!,
      entidad: "event",
      entidadId: String(id),
      accion: "editar",
      campos: [
        "title",
        "event_date",
        "venue",
        "city",
        "lineup",
        "end_at",
        "flyer_url",
        ...(patch.doorPriceCop !== undefined ? ["door_price_cop"] : []),
      ],
    }),
  ]);
  return { ok: true, value: { id } };
}

/**
 * Baja un evento propio del todo.
 *
 * SE NIEGA SI YA SE VENDIÓ UNA BOLETA, y con un mensaje que lo dice.
 * tickets, order_items y ticket_attributions apuntan a events con
 * RESTRICT, así que sin esta guarda Postgres devuelve un
 * foreign_key_violation crudo y el organizador ve una pantalla rota sin
 * entender que el motivo es que alguien ya pagó. Es el mismo bug que ya
 * tuvimos con los colectivos, y entra antes de que exista la primera
 * venta, que es cuando todavía es barato.
 *
 * Una boleta es prueba de un pago: nada de lo que dependa de ella se
 * borra por debajo.
 */
export async function deleteCommunityEvent(
  id: number,
  email?: string | null
): Promise<WriteResult<{ borrado: true }>> {
  const propio = await cargarEventoPropio(id, email);
  if (!propio.ok) return propio;

  const [venta] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM tickets WHERE event_id = ${id}) AS boletas,
      (SELECT COUNT(*)::int FROM order_items WHERE event_id = ${id}) AS items
  `;
  const boletas = Number(venta.boletas) + Number(venta.items);
  if (boletas > 0) {
    return {
      ok: false,
      status: 409,
      error:
        `No se puede borrar: ya hay ${boletas} boleta(s) o pedido(s) contra este evento. ` +
        "Una boleta es prueba de un pago y no se borra por debajo. Si la fiesta se cae, " +
        "escribile al equipo para resolver las devoluciones.",
    };
  }

  const rol = await resolverRolParaRegistro(propio.organizador, email!);
  if (!rol) {
    return {
      ok: false,
      status: 403,
      error:
        "No pude determinar con qué rol registrar este borrado, así que no lo hice. " +
        "Nada se escribe sin registro — y menos un borrado.",
    };
  }

  /**
   * EL REGISTRO VA PRIMERO EN LA LISTA, y no es indiferente. Es la única fila que
   * va a quedar del evento: si el DELETE entra y el registro no, no hay a qué
   * volver. Adentro de una transacción el orden no cambia el resultado —las dos o
   * ninguna— pero ponerlo antes dice qué es lo que no se puede perder.
   */
  await sql.transaction([
    sentenciaDeRegistro(rol, {
      collectiveSlug: propio.organizador,
      actorEmail: email!,
      entidad: "event",
      entidadId: String(id),
      accion: "borrar",
    }),
    sql`DELETE FROM events WHERE id = ${id}`,
  ]);
  return { ok: true, value: { borrado: true } };
}
