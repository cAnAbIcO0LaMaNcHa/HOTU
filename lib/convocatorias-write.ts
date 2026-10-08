/**
 * CONVOCATORIAS (§7) — EL WRITE PATH.
 *
 * El dueño abre un cupo, los DJs se postulan, el dueño acepta o rechaza, y aceptar suma al DJ
 * al lineup del evento. La ruta de API hace auth y valida la forma; esto hace el trabajo.
 *
 * Node-only. Nunca importar desde un client component.
 *
 * ============================================================
 * QUIÉN PUEDE QUÉ, Y POR QUÉ ESTE ESCALÓN Y NO OTRO
 * ============================================================
 *
 * ABRIR, CERRAR, ACEPTAR, RECHAZAR y CANCELAR van por puedeAdministrarColectivo: dueño o
 * SUPER_ADMIN. NO canEditCollective, o sea que un RESIDENTE no decide quién toca.
 *
 * El motivo es el mismo por el que las membresías están en ese escalón: aceptar una
 * postulación programa a una persona en una fiesta, y eso compromete al colectivo frente a
 * alguien de afuera. Es de la misma clase que invitar a un miembro, no de la clase de editar
 * la bio.
 *
 * POSTULARSE y RETIRARSE son del DJ, y la puerta es ser dueño del perfil de artista.
 *
 * ============================================================
 * ESTO NO ESCRIBE edit_log, Y NO ES UN OLVIDO
 * ============================================================
 *
 * Medido: edit_log registra el escalón de CONTENIDO —info del colectivo, eventos, géneros— y
 * NO las membresías ni el editor de lineup del admin. Las convocatorias están en el mismo
 * escalón que las membresías.
 *
 * Y hay una razón más fuerte que el precedente: event_applications ES el registro.
 * resuelta_por, cancelada_por, motivo, resuelta_en y cancelada_en guardan quién decidió qué y
 * cuándo. edit_log guarda NOMBRES DE CAMPO y nunca valores, así que duplicar esto allá
 * guardaría MENOS de lo que ya queda guardado acá.
 *
 * El día que haga falta igual, es una migración que ensancha edit_log_entidad_check —hoy
 * acepta siete valores y ninguno es 'convocatoria', medido— y no un cambio de este archivo.
 *
 * ============================================================
 * LOS AVISOS NO VAN DENTRO DE LA TRANSACCIÓN
 * ============================================================
 *
 * Mismo criterio que los reclamos, y está escrito en lib/mail.ts: sería darle a un aviso el
 * poder de deshacer una decisión. Si la postulación se aceptó, se aceptó; que el aviso no
 * saliera es un problema del aviso, y queda en mail_outbox igual.
 */

import { neon } from "@neondatabase/serverless";
import { puedeAdministrarColectivo, type WriteResult } from "./collectives-gate";
import { CONVOCATORIA_ABIERTA, HOY_EN_BOGOTA, normalizarEnSql } from "./convocatorias";
import { enviar } from "./mail";
/**
 * canEditArtist es dueño del perfil O SUPER_ADMIN, igual que en todo el resto del repo. No se
 * escribe una puerta nueva para esto: una segunda definición de "este perfil es tuyo" es una
 * que un día dice algo distinto.
 */
import { canEditArtist } from "./artists-write";

const sql = neon(process.env.DATABASE_URL!);

/** Los límites de lo que escribe una persona. Recortar y no rechazar donde no cambia nada. */
const MAX_MENSAJE = 1000;
const MAX_DISPONIBILIDAD = 300;
const MAX_NOTA = 500;
const MAX_MOTIVO = 500;

/**
 * Texto obligatorio: null si está vacío o es solo blancos.
 *
 * El conjunto de blancos incluye el espacio duro, y se arma con fromCharCode y no con un
 * escape: la herramienta que escribe archivos acá convierte el escape en el carácter real, y
 * un invisible en el fuente es una bomba de tiempo. Los CHECK de la base hacen la misma
 * comprobación con el mismo conjunto, así que esto es la primera línea y no la única.
 */
const NBSP = String.fromCharCode(160);
const BLANCOS = new RegExp(`^[\\s${NBSP}]*$`);

function textoObligatorio(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || BLANCOS.test(t)) return null;
  return t.slice(0, max);
}

function textoOpcional(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  return textoObligatorio(v, max);
}

/* ===================================================================
 * ABRIR
 * =================================================================== */

export type AbrirInput = {
  eventId: number;
  cupos?: unknown;
  cierraEn?: unknown;
  nota?: unknown;
};

/**
 * Abre la convocatoria de un evento.
 *
 * El colectivo NO se pasa: se lee de events.organizer_slug. Si el llamador pudiera decirlo,
 * podría abrir una convocatoria del evento de otro a nombre del colectivo propio.
 */
export async function abrirConvocatoria(
  input: AbrirInput,
  email?: string | null
): Promise<WriteResult<{ id: number }>> {
  if (!Number.isInteger(input.eventId) || input.eventId <= 0) {
    return { ok: false, status: 404, error: "No encontré ese evento" };
  }

  /**
   * VA EN LA FORMA DE FUNCIÓN y no como template, porque HOY_EN_BOGOTA es una EXPRESIÓN SQL
   * y no un valor: interpolarla en un template la mandaría como parámetro, o sea como el
   * texto literal "(now() AT TIME ZONE ...)" comparado contra una fecha. El driver de Neon
   * no tiene .unsafe para marcar un fragmento como SQL, así que la sentencia se arma y los
   * valores van por $1.
   */
  const [ev] = await sql(
    `SELECT organizer_slug, event_date, censored_at,
            event_date < ${HOY_EN_BOGOTA} AS ya_paso
     FROM events WHERE id = $1`,
    [input.eventId]
  );
  if (!ev || !ev.organizer_slug) {
    return { ok: false, status: 404, error: "No encontré ese evento" };
  }
  const colectivo = ev.organizer_slug as string;

  if (!(await puedeAdministrarColectivo(colectivo, email))) {
    return {
      ok: false,
      status: 403,
      error:
        "Solo el dueño del colectivo puede abrir una convocatoria. Aceptar una postulación " +
        "programa a una persona en una fiesta, así que está en el mismo escalón que invitar " +
        "a un miembro y no en el de editar la info.",
    };
  }

  if (ev.ya_paso) {
    return {
      ok: false,
      status: 409,
      error: "Esa fiesta ya pasó: no se puede abrir una convocatoria para buscar quién toque.",
    };
  }

  /** cupos: NULL = no dijo cuántos. 0 no vale, y el CHECK de la base lo niega igual. */
  let cupos: number | null = null;
  if (input.cupos !== undefined && input.cupos !== null && input.cupos !== "") {
    const n = Number(input.cupos);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        ok: false,
        status: 400,
        error: "Los cupos tienen que ser un número entero mayor que cero, o venir vacíos.",
      };
    }
    cupos = n;
  }

  const cierre = validarCierre(input.cierraEn, ev.event_date);
  if (!cierre.ok) return cierre;

  const nota = textoOpcional(input.nota, MAX_NOTA);

  try {
    const [fila] = await sql`
      INSERT INTO event_calls (event_id, collective_slug, cupos, cierra_en, nota, abierta_por)
      VALUES (${input.eventId}, ${colectivo}, ${cupos}, ${cierre.value}, ${nota}, ${email})
      RETURNING id`;
    return { ok: true, value: { id: fila.id as number } };
  } catch (e) {
    /**
     * El índice único parcial event_calls_una_abierta_idx se traduce a un 409 limpio.
     * Dejarlo salir como violación de índice sería un 500 que no dice nada, y el caso no es
     * raro: dos pestañas abiertas del panel alcanzan.
     */
    if (esViolacionDe(e, "event_calls_una_abierta_idx")) {
      return {
        ok: false,
        status: 409,
        error: "Ese evento ya tiene una convocatoria abierta.",
      };
    }
    throw e;
  }
}

/**
 * cierra_en NO PUEDE SER POSTERIOR AL EVENTO, y la regla vive acá y no en un CHECK.
 *
 * Un CHECK no puede cruzar tablas: la fecha del evento está en events y el cierre en
 * event_calls. Y aunque pudiera, dependería de la zona, porque event_date es un DATE y
 * cierra_en un instante.
 *
 * El borde es el FIN del día del evento en Bogotá, no su medianoche: una convocatoria que
 * cierra "el mismo día de la fiesta" es legítima, y comparar contra la medianoche la
 * rechazaría.
 */
function validarCierre(
  valor: unknown,
  eventDate: unknown
): WriteResult<string | null> {
  if (valor === undefined || valor === null || valor === "") {
    return { ok: true, value: null };
  }
  const iso = String(valor);
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) {
    return { ok: false, status: 400, error: "La fecha de cierre no se entiende." };
  }
  const dia =
    eventDate instanceof Date
      ? `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, "0")}-${String(
          eventDate.getDate()
        ).padStart(2, "0")}`
      : String(eventDate).slice(0, 10);
  /** El offset de Bogotá, explícito: el server corre en UTC. */
  const finDelDia = new Date(`${dia}T23:59:59-05:00`);
  if (cuando > finDelDia) {
    return {
      ok: false,
      status: 400,
      error:
        `La convocatoria no puede cerrar después de la fiesta. El evento es el ${dia}, así ` +
        "que el cierre tiene que caer ese día o antes.",
    };
  }
  return { ok: true, value: cuando.toISOString() };
}

/* ===================================================================
 * CERRAR
 * =================================================================== */

/**
 * Cierra la convocatoria y RECHAZA LAS PENDIENTES EN LA MISMA TRANSACCIÓN.
 *
 * Las dos cosas o ninguna: una convocatoria cerrada con pendientes adentro es un estado en el
 * que nadie va a responderle a esa gente y nada lo dice. Por eso no son dos llamadas.
 *
 * El motivo de esos rechazos queda en NULL a propósito: no lo escribió nadie. Inventar
 * "cerrada por el dueño" sería poner en boca del dueño una frase que no dijo — y el CHECK de
 * la base acepta un rechazo sin motivo justamente para esto.
 */
export async function cerrarConvocatoria(
  callId: number,
  email?: string | null
): Promise<WriteResult<{ rechazadas: number }>> {
  const dueno = await cargarCallAdministrable(callId, email);
  if (!dueno.ok) return dueno;

  const [cerrada, rechazadas] = await sql.transaction([
    sql`
      UPDATE event_calls SET cerrada_en = now(), cerrada_por = ${email}
      WHERE id = ${callId} AND cerrada_en IS NULL
      RETURNING id`,
    sql`
      UPDATE event_applications
      SET resuelta_en = now(), resultado = 'rechazada', resuelta_por = ${email}
      WHERE call_id = ${callId} AND resuelta_en IS NULL
      RETURNING id, artist_slug`,
  ]);

  if ((cerrada as unknown[]).length === 0) {
    return { ok: false, status: 409, error: "Esa convocatoria ya estaba cerrada." };
  }

  const filas = rechazadas as Array<{ artist_slug: string }>;
  for (const f of filas) {
    await avisarAlDj(f.artist_slug, {
      tipo: "postulacion_rechazada",
      evento: dueno.value.eventTitle,
      colectivo: dueno.value.collectiveSlug,
      motivo: null,
    });
  }
  return { ok: true, value: { rechazadas: filas.length } };
}

/* ===================================================================
 * POSTULARSE Y RETIRARSE — del DJ
 * =================================================================== */

export type PostularInput = {
  callId: number;
  artistSlug: string;
  mensaje?: unknown;
  disponibilidad?: unknown;
};

export async function postularse(
  input: PostularInput,
  email?: string | null
): Promise<WriteResult<{ id: number }>> {
  if (!(await canEditArtist(input.artistSlug, email))) {
    return { ok: false, status: 403, error: "Ese perfil de DJ no es tuyo." };
  }

  const mensaje = textoObligatorio(input.mensaje, MAX_MENSAJE);
  if (!mensaje) {
    return {
      ok: false,
      status: 400,
      error: "Escribí un mensaje: es lo que el dueño del colectivo va a leer para decidir.",
    };
  }
  const disponibilidad = textoObligatorio(input.disponibilidad, MAX_DISPONIBILIDAD);
  if (!disponibilidad) {
    return {
      ok: false,
      status: 400,
      error: "Decí cuándo podés tocar. Sin eso, el dueño no puede programarte.",
    };
  }

  /**
   * LA CONVOCATORIA ABIERTA SE DERIVA ACÁ TAMBIÉN, con la misma expresión que usan los
   * lectores. Si se preguntara solo por cerrada_en, una convocatoria cuyo cierre ya pasó
   * seguiría aceptando postulaciones hasta que el cron la barriera.
   */
  const [call] = await sql(
    `SELECT ec.id, ec.event_id, ec.collective_slug, e.title,
            (${CONVOCATORIA_ABIERTA}) AS abierta
     FROM event_calls ec JOIN events e ON e.id = ec.event_id
     WHERE ec.id = $1`,
    [input.callId]
  );
  if (!call) return { ok: false, status: 404, error: "No encontré esa convocatoria" };
  if (!call.abierta) {
    return {
      ok: false,
      status: 409,
      error: "Esa convocatoria ya está cerrada.",
    };
  }

  /**
   * UN DJ QUE YA ESTÁ EN EL LINEUP NO SE POSTULA, y se compara por el slug RESUELTO y no por
   * nombre: si ya tiene fila resuelta, está programado y postularse no significa nada.
   *
   * Una fila SIN resolver con su nombre NO lo frena, y es deliberado: esa fila es una
   * conjetura del importador, no una confirmación. Aceptarlo después la reemplaza.
   */
  const [enLineup] = await sql`
    SELECT 1 FROM event_lineup
    WHERE event_id = ${call.event_id} AND artist_slug = ${input.artistSlug}`;
  if (enLineup) {
    return {
      ok: false,
      status: 409,
      error: "Ya estás en el lineup de esa fiesta.",
    };
  }

  try {
    const [fila] = await sql`
      INSERT INTO event_applications (call_id, artist_slug, mensaje, disponibilidad)
      VALUES (${input.callId}, ${input.artistSlug}, ${mensaje}, ${disponibilidad})
      RETURNING id`;
    return { ok: true, value: { id: fila.id as number } };
  } catch (e) {
    if (esViolacionDe(e, "event_applications_una_pendiente_idx")) {
      return {
        ok: false,
        status: 409,
        error: "Ya tenés una postulación sin responder en esa convocatoria.",
      };
    }
    throw e;
  }
}

/** El DJ se baja. Solo si todavía no la resolvieron. */
export async function retirarPostulacion(
  appId: number,
  email?: string | null
): Promise<WriteResult<{ retirada: true }>> {
  const [app] = await sql`SELECT artist_slug FROM event_applications WHERE id = ${appId}`;
  if (!app) return { ok: false, status: 404, error: "No encontré esa postulación" };
  if (!(await canEditArtist(app.artist_slug as string, email))) {
    return { ok: false, status: 403, error: "Esa postulación no es tuya." };
  }
  const filas = await sql`
    UPDATE event_applications
    SET resuelta_en = now(), resultado = 'retirada'
    WHERE id = ${appId} AND resuelta_en IS NULL
    RETURNING id`;
  if (filas.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Esa postulación ya estaba resuelta, así que no hay nada que retirar.",
    };
  }
  return { ok: true, value: { retirada: true } };
}

/* ===================================================================
 * ACEPTAR Y RECHAZAR — del dueño
 * =================================================================== */

/**
 * ACEPTAR, EN UNA SOLA SENTENCIA.
 *
 * Cuatro cosas tienen que pasar juntas o ninguna: marcar la postulación, borrar la fila SIN
 * RESOLVER del lineup que lleva el mismo nombre, insertar la fila resuelta, y calcular su
 * posición. Partirlo en varias deja estados que nadie puede leer — una postulación aceptada
 * sin fila en el lineup, o dos filas del mismo DJ.
 *
 * ES UN CTE QUE MODIFICA DATOS, igual que el que usa crear-un-evento-con-su-registro. Las
 * cuatro ramas ven la MISMA foto de la base, así que la posición que calcula `pos` no incluye
 * la fila que `vieja` está borrando ni la que `nueva` inserta.
 *
 * POR QUÉ HAY QUE BORRAR LA FILA SIN RESOLVER: event_lineup_event_artist_idx es UNIQUE sobre
 * (event_id, artist_slug) pero PARCIAL sobre artist_slug IS NOT NULL, así que NO VE las filas
 * sin resolver. Medido: 7 de las 9 filas de dev están así. Sin el DELETE, el lineup mostraría
 * al DJ dos veces —una como texto suelto del flyer y otra resuelta— sin ningún error.
 *
 * raw_name SE LLENA CON EL NOMBRE DEL ARTISTA: es NOT NULL sin default. Y position se calcula
 * como max+1 y no se omite, porque su default es 0 y omitirla metería a cada DJ aceptado
 * ARRIBA de todo el lineup importado. No falla: reordena.
 */
export async function aceptarPostulacion(
  appId: number,
  email?: string | null
): Promise<WriteResult<{ lineupId: number; reemplazo: boolean }>> {
  const ctx = await cargarPostulacionAdministrable(appId, email);
  if (!ctx.ok) return ctx;
  const { eventId, artistSlug, artistName, eventTitle, collectiveSlug } = ctx.value;

  let filas: Array<{ lineup_id: number; reemplazo: boolean }>;
  try {
    filas = (await sql(
      `WITH marcada AS (
         UPDATE event_applications
         SET resuelta_en = now(), resultado = 'aceptada', resuelta_por = $4
         WHERE id = $1 AND resuelta_en IS NULL
         RETURNING id
       ),
       vieja AS (
         DELETE FROM event_lineup
         WHERE event_id = $2
           AND artist_slug IS NULL
           AND ${normalizarEnSql("raw_name")} = ${normalizarEnSql("$5")}
           AND EXISTS (SELECT 1 FROM marcada)
         RETURNING id, position
       ),
       pos AS (
         SELECT COALESCE(
                  (SELECT MIN(position) FROM vieja),
                  (SELECT COALESCE(MAX(position), -1) + 1 FROM event_lineup WHERE event_id = $2)
                ) AS p
       )
       INSERT INTO event_lineup (event_id, raw_name, artist_slug, position)
       SELECT $2, $5, $3, (SELECT p FROM pos)
       WHERE EXISTS (SELECT 1 FROM marcada)
       RETURNING id AS lineup_id, (SELECT COUNT(*) > 0 FROM vieja) AS reemplazo`,
      [appId, eventId, artistSlug, email, artistName]
    )) as Array<{ lineup_id: number; reemplazo: boolean }>;
  } catch (e) {
    /**
     * Y LA VIOLACIÓN DEL ÍNDICE SE VUELVE UN 409 LIMPIO. Puede pasar aunque el DJ no estuviera
     * en el lineup al postularse: entre eso y el aceptar, alguien pudo agregarlo a mano desde
     * el editor del admin. No es un bug, es una carrera real, y el mensaje tiene que decir qué
     * pasó en vez de mostrar el nombre de un índice.
     */
    if (esViolacionDe(e, "event_lineup_event_artist_idx")) {
      return {
        ok: false,
        status: 409,
        error:
          "Ese DJ ya está en el lineup de la fiesta, así que no hace falta aceptarlo: " +
          "alguien lo agregó a mano mientras esta postulación estaba abierta. Rechazala o " +
          "sacalo del lineup primero.",
      };
    }
    throw e;
  }

  if (filas.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Esa postulación ya estaba resuelta.",
    };
  }

  await avisarAlDj(artistSlug, {
    tipo: "postulacion_aceptada",
    evento: eventTitle,
    colectivo: collectiveSlug,
    motivo: null,
  });
  return {
    ok: true,
    value: { lineupId: filas[0].lineup_id, reemplazo: Boolean(filas[0].reemplazo) },
  };
}

/** Rechazar. El motivo es OPCIONAL, y eso está decidido. */
export async function rechazarPostulacion(
  appId: number,
  motivoCrudo: unknown,
  email?: string | null
): Promise<WriteResult<{ rechazada: true }>> {
  const ctx = await cargarPostulacionAdministrable(appId, email);
  if (!ctx.ok) return ctx;

  const motivo = textoOpcional(motivoCrudo, MAX_MOTIVO);
  const filas = await sql`
    UPDATE event_applications
    SET resuelta_en = now(), resultado = 'rechazada', resuelta_por = ${email}, motivo = ${motivo}
    WHERE id = ${appId} AND resuelta_en IS NULL
    RETURNING id`;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Esa postulación ya estaba resuelta." };
  }

  await avisarAlDj(ctx.value.artistSlug, {
    tipo: "postulacion_rechazada",
    evento: ctx.value.eventTitle,
    colectivo: ctx.value.collectiveSlug,
    motivo,
  });
  return { ok: true, value: { rechazada: true } };
}

/* ===================================================================
 * CANCELAR LA PARTICIPACIÓN
 * =================================================================== */

/**
 * SACA AL DJ ACEPTADO DEL LINEUP, CON MOTIVO OBLIGATORIO.
 *
 * Las dos mitades van en la MISMA transacción: la postulación pasa a 'cancelada' y la fila del
 * lineup se va. Partirlo deja un DJ anunciado en una fiesta de la que ya lo sacaron, o al
 * revés.
 *
 * EL MOTIVO ES OBLIGATORIO acá y opcional al rechazar, y la diferencia la sostiene también la
 * base con event_applications_cancelacion_check. Rechazar es no elegir a alguien; cancelar es
 * DESHACER algo que el DJ ya tiene anunciado. La única de las dos que le saca algo que ya
 * tenía es la segunda, así que es la única que tiene que explicarse.
 *
 * resuelta_en NO SE TOCA: sigue guardando cuándo se aceptó. El par con cancelada_en es lo que
 * permite decir cuánto tiempo el DJ estuvo programado.
 */
export async function cancelarParticipacion(
  appId: number,
  motivoCrudo: unknown,
  email?: string | null
): Promise<WriteResult<{ cancelada: true }>> {
  const ctx = await cargarPostulacionAdministrable(appId, email);
  if (!ctx.ok) return ctx;

  const motivo = textoObligatorio(motivoCrudo, MAX_MOTIVO);
  if (!motivo) {
    return {
      ok: false,
      status: 400,
      error:
        "Escribí por qué cancelás la participación. El DJ ya tiene la fecha anunciada, así " +
        "que sacarlo sin decir nada le deja una fiesta menos y ninguna explicación.",
    };
  }

  const [marcada] = await sql.transaction([
    sql`
      UPDATE event_applications
      SET resultado = 'cancelada', cancelada_en = now(), cancelada_por = ${email}, motivo = ${motivo}
      WHERE id = ${appId} AND resultado = 'aceptada'
      RETURNING id`,
    sql`
      DELETE FROM event_lineup
      WHERE event_id = ${ctx.value.eventId} AND artist_slug = ${ctx.value.artistSlug}`,
  ]);

  if ((marcada as unknown[]).length === 0) {
    return {
      ok: false,
      status: 409,
      error:
        "Solo se puede cancelar la participación de una postulación ACEPTADA. Esta no lo " +
        "está, así que no hay nada que deshacer.",
    };
  }

  await avisarAlDj(ctx.value.artistSlug, {
    tipo: "postulacion_cancelada",
    evento: ctx.value.eventTitle,
    colectivo: ctx.value.collectiveSlug,
    motivo,
  });
  return { ok: true, value: { cancelada: true } };
}

/* ===================================================================
 * LO COMPARTIDO
 * =================================================================== */

/** Carga una convocatoria y comprueba que quien pide la pueda administrar. */
async function cargarCallAdministrable(
  callId: number,
  email?: string | null
): Promise<WriteResult<{ collectiveSlug: string; eventId: number; eventTitle: string }>> {
  if (!Number.isInteger(callId) || callId <= 0) {
    return { ok: false, status: 404, error: "No encontré esa convocatoria" };
  }
  const [c] = await sql`
    SELECT ec.collective_slug, ec.event_id, e.title
    FROM event_calls ec JOIN events e ON e.id = ec.event_id
    WHERE ec.id = ${callId}`;
  if (!c) return { ok: false, status: 404, error: "No encontré esa convocatoria" };
  if (!(await puedeAdministrarColectivo(c.collective_slug as string, email))) {
    return { ok: false, status: 403, error: "Esa convocatoria no es tuya." };
  }
  return {
    ok: true,
    value: {
      collectiveSlug: c.collective_slug as string,
      eventId: c.event_id as number,
      eventTitle: c.title as string,
    },
  };
}

/** Lo mismo para una postulación, trayendo además el nombre del artista. */
async function cargarPostulacionAdministrable(
  appId: number,
  email?: string | null
): Promise<
  WriteResult<{
    eventId: number;
    artistSlug: string;
    artistName: string;
    eventTitle: string;
    collectiveSlug: string;
  }>
> {
  if (!Number.isInteger(appId) || appId <= 0) {
    return { ok: false, status: 404, error: "No encontré esa postulación" };
  }
  const [a] = await sql`
    SELECT ea.artist_slug, ar.name AS artist_name,
           ec.collective_slug, ec.event_id, e.title
    FROM event_applications ea
    JOIN event_calls ec ON ec.id = ea.call_id
    JOIN events e ON e.id = ec.event_id
    JOIN artists ar ON ar.slug = ea.artist_slug
    WHERE ea.id = ${appId}`;
  if (!a) return { ok: false, status: 404, error: "No encontré esa postulación" };
  if (!(await puedeAdministrarColectivo(a.collective_slug as string, email))) {
    return { ok: false, status: 403, error: "Esa postulación no es tuya." };
  }
  return {
    ok: true,
    value: {
      eventId: a.event_id as number,
      artistSlug: a.artist_slug as string,
      artistName: a.artist_name as string,
      eventTitle: a.title as string,
      collectiveSlug: a.collective_slug as string,
    },
  };
}

/**
 * ¿Es este error la violación de ESE índice o constraint?
 *
 * Se mira el NOMBRE y no el texto del mensaje, porque el mensaje cambia con la versión y con
 * el idioma del servidor. El driver de Neon pone el nombre en `constraint`, y el fallback por
 * mensaje está para la ruta HTTP, donde a veces llega solo el texto.
 */
function esViolacionDe(e: unknown, nombre: string): boolean {
  const err = e as { constraint?: string; message?: string } | null;
  if (!err) return false;
  if (err.constraint === nombre) return true;
  return typeof err.message === "string" && err.message.includes(nombre);
}

/**
 * El aviso al DJ, a la cuenta dueña del perfil.
 *
 * SIN DUEÑO NO HAY AVISO, y no es un error: un perfil desamparado no tiene a quién avisarle.
 * La postulación igual queda resuelta y visible en la bandeja de la web cuando alguien lo
 * reclame. Por eso esto no devuelve nada que el llamador tenga que mirar.
 */
async function avisarAlDj(
  artistSlug: string,
  d: { tipo: TipoAvisoConvocatoria; evento: string; colectivo: string; motivo: string | null }
): Promise<void> {
  const [ar] = await sql`SELECT owner_email, name FROM artists WHERE slug = ${artistSlug}`;
  if (!ar?.owner_email) return;
  await enviar({
    tipo: d.tipo,
    para: ar.owner_email as string,
    evento: d.evento,
    colectivo: d.colectivo,
    artista: { tipo: "artist", slug: artistSlug, nombre: ar.name as string },
    motivo: d.motivo,
  });
}

type TipoAvisoConvocatoria =
  | "postulacion_aceptada"
  | "postulacion_rechazada"
  | "postulacion_cancelada";
