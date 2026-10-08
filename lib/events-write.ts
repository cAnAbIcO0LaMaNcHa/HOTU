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
import { armarInstante, horaEnBogota, OFFSET_BOGOTA } from "./date-utils";
import { enviar } from "./mail";
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
  /**
   * HH:MM, la hora de INICIO. Vacío = no dijo hora, y la página no la muestra.
   * El lib la combina con date y le pone la zona; el formulario NO manda un
   * instante, porque un instante armado en el navegador trae la zona de quien mire.
   */
  startTime?: unknown;
  /** HH:MM, la hora de CIERRE. Misma regla de madrugada que la de inicio. */
  endTime?: unknown;
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
  /**
   * ============================================================
   * LA HORA DE INICIO Y LA DE CIERRE, LAS DOS CON LA MISMA REGLA
   * ============================================================
   *
   * ANTES end_at LLEGABA COMO datetime-local Y SE PARSEABA CON new Date(), Y ESO
   * ERA UN BUG DE CINCO HORAS.
   *
   * Un `datetime-local` manda "2026-11-16T06:00", sin offset. `new Date()` de un
   * string así lo interpreta en la zona del SERVIDOR, y Vercel corre en UTC: una
   * fiesta que cerraba 06:00 en Bogotá quedaba guardada como 06:00 UTC, o sea
   * 01:00 de Bogotá. Sin error en ningún lado, y el año y el día pasaban todas las
   * validaciones porque el problema no era el día.
   *
   * Ahora las dos horas llegan como HH:MM y se combinan con event_date usando
   * armarInstante, que pone el offset EXPLÍCITO y aplica la regla de la madrugada:
   * de 00:00 a 06:00 el instante cae en el día SIGUIENTE, porque una fiesta del 15
   * que cierra a las 6 cierra el 16.
   *
   * Eso hace que el caso más común de la escena —arranca 23:00, cierra 06:00— salga
   * bien solo, sin que nadie tenga que entender por qué el cierre es "otro día".
   */
  const startRaw = limpiarTexto(input.startTime);
  let startsAt: string | null = null;
  if (startRaw) {
    const armado = armarInstante(date, startRaw);
    if (!armado) {
      return { ok: false, status: 400, error: "La hora de inicio no se entiende. Usá HH:MM." };
    }
    startsAt = armado.iso;
  }

  const endRaw = limpiarTexto(input.endTime);
  let endAt: string | null = null;
  if (endRaw) {
    const armado = armarInstante(date, endRaw);
    if (!armado) {
      return { ok: false, status: 400, error: "La hora de cierre no se entiende. Usá HH:MM." };
    }
    endAt = armado.iso;
  }

  /**
   * El CHECK de la base rechaza end_at <= starts_at, pero un mensaje entendible es
   * mejor que una violación de constraint. Y con la regla de la madrugada este caso
   * es raro: 23:00 → 06:00 ya sale bien porque el cierre se fue al día siguiente.
   * Lo que sí cae acá es 23:00 → 22:00, que no tiene lectura razonable.
   */
  if (startsAt && endAt && new Date(endAt) <= new Date(startsAt)) {
    return {
      ok: false,
      status: 400,
      error:
        "La hora de cierre cae antes o igual que la de inicio. Si la fiesta termina de " +
        "madrugada, poné la hora de cierre igual: de 00:00 a 06:00 ya se entiende como el día siguiente.",
    };
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
        (event_date, starts_at, end_at, flyer_url, city, venue, title, lineup, organizer_slug,
         door_price_cop,
         district, scope, country_code, language, status, featured, priority_at)
      VALUES
        (${date}, ${startsAt}, ${endAt}, ${flyerUrl}, ${city}, ${venue},
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
  /** HH:MM. Ausente = no la toques; vacía = borrala. */
  startTime?: unknown;
  endTime?: unknown;
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
/**
 * El valor de vuelta lleva `cierreRecortadoA`, que es la MITAD DEL ORGANIZADOR del aviso de
 * recorte: null cuando no se tocó nada, y el día nuevo cuando la convocatoria se acortó.
 *
 * Va en el valor y no en un console.log porque tiene que llegar a la pantalla: un ajuste
 * silencioso sobre una fecha que el organizador eligió es justamente lo que esta pieza no
 * quiere. La ruta lo pasa tal cual y el formulario lo muestra al guardar.
 */
export async function updateCommunityEvent(
  id: number,
  patch: ParcheEvento,
  email?: string | null
): Promise<WriteResult<{ id: number; cierreRecortadoA: string | null }>> {
  const propio = await cargarEventoPropio(id, email);
  if (!propio.ok) return propio;

  const [actual] = await sql`
    SELECT event_date::text AS d, venue, city, title, lineup, flyer_url, starts_at, end_at, door_price_cop
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
  /**
   * LAS DOS HORAS SE RE-ARMAN CONTRA EL DÍA QUE VA A QUEDAR, no contra el viejo.
   *
   * Y eso importa más de lo que parece: si el organizador CORRIGE LA FECHA del
   * evento, las horas tienen que mudarse con ella. Conservar el timestamp viejo
   * dejaría una fiesta anunciada para el 22 con su inicio guardado el 15 — un
   * evento que, para eventHasEnded y para la agenda, ya pasó.
   *
   * Por eso se guarda la HORA de lo que había (en Bogotá) y se re-arma con `date`,
   * que a esta altura ya es la fecha final. Es también la razón por la que la hora
   * viaja como HH:MM y no como instante: una hora se puede mudar de día, un
   * instante ya eligió el suyo.
   */
  let startsAt: string | null = null;
  {
    const horaActual = horaEnBogota((actual.starts_at as string | null) ?? null);
    const crudo =
      patch.startTime !== undefined ? limpiarTexto(patch.startTime) : horaActual;
    if (crudo) {
      const armado = armarInstante(date, crudo);
      if (!armado) {
        return { ok: false, status: 400, error: "La hora de inicio no se entiende. Usá HH:MM." };
      }
      startsAt = armado.iso;
    }
  }

  let endAt: string | null = null;
  {
    const horaActual = horaEnBogota((actual.end_at as string | null) ?? null);
    const crudo = patch.endTime !== undefined ? limpiarTexto(patch.endTime) : horaActual;
    if (crudo) {
      const armado = armarInstante(date, crudo);
      if (!armado) {
        return { ok: false, status: 400, error: "La hora de cierre no se entiende. Usá HH:MM." };
      }
      endAt = armado.iso;
    }
  }

  if (startsAt && endAt && new Date(endAt) <= new Date(startsAt)) {
    return {
      ok: false,
      status: 400,
      error:
        "La hora de cierre cae antes o igual que la de inicio. Si la fiesta termina de " +
        "madrugada, poné la hora de cierre igual: de 00:00 a 06:00 ya se entiende como el día siguiente.",
    };
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
  /**
   * EL RECORTE DE cierra_en VA EN ESTA MISMA TRANSACCIÓN, Y SOLO PUEDE ACORTAR.
   *
   * Una convocatoria no puede cerrar después de la fiesta. Esa regla se valida al ABRIRLA,
   * pero la fecha del evento se puede mover DESPUÉS, y entonces queda una convocatoria
   * abierta cuyo cierre cae más tarde que el evento al que convoca.
   *
   * DECIDIDO: SE AJUSTA, NO SE RECHAZA. Mover la fecha de una fiesta es una cosa que pasa y
   * no tiene por qué frenarse por una convocatoria; lo que no puede pasar es que el ajuste
   * sea invisible, y de eso se ocupan las dos mitades de abajo.
   *
   * SOLO ACORTA, NUNCA ALARGA. El WHERE pide cierra_en > el nuevo fin del día, así que
   * mover la fiesta para ADELANTE no toca nada: un cierre que ya era anterior sigue siendo
   * válido, y estirarlo sería regalarle plazo a una convocatoria que su dueño quiso corta.
   *
   * SE RECORTA AL FIN DEL DÍA DEL EVENTO EN BOGOTÁ y no a su medianoche, por lo mismo que
   * al abrir: cerrar el mismo día de la fiesta es legítimo.
   *
   * Y va con el dato y no después porque es parte del mismo cambio: si el recorte no entra,
   * la fecha nueva tampoco, y nadie queda con una convocatoria que cierra después de su
   * propia fiesta.
   */
  const finDelDiaNuevo = `${date}T23:59:59${OFFSET_BOGOTA}`;

  const [, , recortadas] = await sql.transaction([
    sql`
      UPDATE events SET
        title = ${title}, event_date = ${date}, venue = ${venue}, city = ${city}, lineup = ${lineup},
        starts_at = ${startsAt}, end_at = ${endAt}, flyer_url = ${flyerUrl},
        door_price_cop = ${doorPrice}
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
    /**
     * El RETURNING trae lo que hace falta para contarlo: el id de la convocatoria y su
     * cierre nuevo. Sin él, "se recortó" sería una afirmación y no una medición — y es el
     * dato que el organizador va a ver al guardar.
     */
    sql`
      UPDATE event_calls SET cierra_en = ${finDelDiaNuevo}::timestamptz
      WHERE event_id = ${id}
        AND cerrada_en IS NULL
        AND cierra_en IS NOT NULL
        AND cierra_en > ${finDelDiaNuevo}::timestamptz
      RETURNING id, cierra_en
    `,
  ]);

  /**
   * Y SI SE RECORTÓ, NO SE QUEDA CALLADO. Dos mitades, porque son dos personas distintas:
   *
   *   el ORGANIZADOR lo ve al guardar, en el valor que devuelve esta función;
   *   los DJ CON POSTULACIÓN PENDIENTE lo ven en su bandeja, por lib/mail.ts.
   *
   * El aviso al DJ es el que importa: lo que el recorte le cambia es el plazo que tiene para
   * que le respondan, y enterarse de eso por no recibir respuesta es la peor manera.
   *
   * Fuera de la transacción, igual que todos los avisos: sería darle a un aviso el poder de
   * deshacer un cambio de fecha.
   */
  const recorte = (recortadas as Array<{ id: number; cierra_en: unknown }>)[0] ?? null;
  if (recorte) await avisarCierreRecortado(recorte.id, id, date);

  return {
    ok: true,
    value: { id, cierreRecortadoA: recorte ? date : null },
  };
}

/**
 * Les deja el aviso a los DJ con postulación PENDIENTE en esa convocatoria.
 *
 * Solo las pendientes: a quien ya le respondieron, el plazo no le cambia nada.
 *
 * NUNCA TIRA. Un aviso que falla no puede voltear un cambio de fecha que ya se guardó, y lo
 * que pasó queda en mail_outbox igual.
 */
async function avisarCierreRecortado(
  callId: number,
  eventId: number,
  nuevaFecha: string
): Promise<void> {
  try {
    const filas = await sql`
      SELECT ar.owner_email, ar.name, ar.slug, e.title, ec.collective_slug
      FROM event_applications ea
      JOIN event_calls ec ON ec.id = ea.call_id
      JOIN events e ON e.id = ec.event_id
      JOIN artists ar ON ar.slug = ea.artist_slug
      WHERE ea.call_id = ${callId} AND ea.resuelta_en IS NULL AND ar.owner_email IS NOT NULL
    `;
    for (const f of filas) {
      await enviar({
        tipo: "convocatoria_cierre_recortado",
        para: f.owner_email as string,
        artista: { tipo: "artist", slug: f.slug as string, nombre: f.name as string },
        evento: f.title as string,
        colectivo: f.collective_slug as string,
        cierraEn: nuevaFecha,
      });
    }
  } catch (e) {
    console.error(`no pude avisar el recorte de cierre de la convocatoria ${callId} del evento ${eventId}`, e);
  }
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

  /**
   * Y LA MISMA GUARDA PARA LAS CONVOCATORIAS, por la misma razón que las boletas.
   *
   * event_calls.event_id es ON DELETE RESTRICT, así que sin esta consulta el DELETE de abajo
   * tiraría una violación de FK cruda —un 500 sin explicación— en vez del 409 que dice qué
   * pasó. El RESTRICT ya garantiza que no se pierda nada; lo que falta es que el organizador
   * entienda por qué no pudo.
   *
   * SE CUENTAN LAS CONVOCATORIAS Y LAS POSTULACIONES POR SEPARADO porque son dos cosas
   * distintas de perder: una convocatoria sin postulaciones es un cupo que nadie pidió, y una
   * con postulaciones es gente que se anotó y a la que hay que responderle. El mensaje tiene
   * que poder distinguirlas.
   */
  const [conv] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM event_calls WHERE event_id = ${id}) AS convocatorias,
      (SELECT COUNT(*)::int FROM event_applications ea
        JOIN event_calls ec ON ec.id = ea.call_id
       WHERE ec.event_id = ${id}) AS postulaciones
  `;
  if (Number(conv.convocatorias) > 0) {
    const n = Number(conv.postulaciones);
    return {
      ok: false,
      status: 409,
      error:
        `No se puede borrar: este evento tiene una convocatoria` +
        (n > 0
          ? ` con ${n} postulación(es). Cada una es el registro de una decisión entre vos y un ` +
            "DJ, y no se borra por debajo. Cerrá la convocatoria y resolvé las postulaciones " +
            "pendientes primero."
          : ". Cerrala primero y volvé a intentar."),
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
