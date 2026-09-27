/**
 * LA RESIDENCIA: EL DUEÑO OFRECE, EL DJ ACEPTA (§8 fase 2).
 *
 * ============================================================
 * POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ ES EL ÚNICO
 * ============================================================
 *
 * Hasta la fase 2, el DJ elegía solo cuál de sus colectivos era su núcleo:
 * chooseKind pedía únicamente isArtistOwner, y su mensaje lo decía —"Solo el
 * DJ elige si un colectivo es su casa"—. Eso estaba bien mientras fuera una
 * ETIQUETA.
 *
 * En la fase 2 'residente' es PERMISO PARA EDITAR el colectivo. Con la puerta
 * vieja intacta, cualquier miembro de cualquier colectivo podía ascenderse a
 * sí mismo y quedarse con permiso de edición sobre un perfil ajeno, con una
 * sola llamada y sin que el dueño se enterara. El renombre por sí solo habría
 * abierto eso: la palabra sigue igual y el poder que otorga cambió.
 *
 * Así que la decisión cambia de manos. El dueño OFRECE, el DJ ACEPTA, y las
 * dos mitades quedan escritas en residency_offers.
 *
 * ESTE ES EL ÚNICO ARCHIVO QUE ESCRIBE kind = 'residente'. No es una
 * convención, es la propiedad que hace verificable todo lo anterior: si
 * aparece un segundo lugar que lo escriba, hay un camino para ganar permisos
 * que nadie revisó. La batería lo comprueba con un grep, porque un invariante
 * que nadie mide es una intención.
 *
 * ============================================================
 * LAS DOS GUARDAS QUE EL SCHEMA NO PUEDE DAR
 * ============================================================
 *
 * Está MEDIDO en la cabecera de setup-residency-offers: el schema acepta una
 * oferta a un venue, porque el FK prueba que el slug existe en collectives y
 * no que su entity_kind sea 'collective', y un CHECK no puede consultar otra
 * tabla. Y no puede impedir que se acepte teniendo otra residencia, porque
 * ese índice vive en la otra tabla y recién se entera al escribir.
 *
 * Las dos viven acá. Si alguna vez se mueven, se mueven juntas.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { puedeAdministrarColectivo, type WriteResult } from "./collectives-gate";

const sql = neon(process.env.DATABASE_URL!);

/** ¿Este email es dueño del perfil de artista, o sea habla por el DJ? */
async function esDuenoDelArtista(artistSlug: string, email?: string | null): Promise<boolean> {
  if (!email) return false;
  const rows = await sql`SELECT owner_email FROM artists WHERE slug = ${artistSlug}`;
  const owner = rows[0]?.owner_email as string | null | undefined;
  return Boolean(owner && owner.toLowerCase() === email.toLowerCase());
}

/**
 * UN VENUE NO ES LA RESIDENCIA DE NADIE.
 *
 * En un venue se es miembro. La residencia es de un colectivo, y no es un
 * detalle de presentación: §6 dice que los sets y tracks republicados siguen a
 * la residencia, así que una residencia en un venue mudaría la discografía del
 * DJ hacia el venue — y devolver el kind después NO deshace la republicación.
 */
async function rechazarResidenciaEnVenue(collectiveSlug: string): Promise<WriteResult<never> | null> {
  const rows = await sql`
    SELECT name, entity_kind FROM collectives WHERE slug = ${collectiveSlug}`;
  if (rows.length === 0) return { ok: false, status: 404, error: "Ese colectivo no existe" };
  if ((rows[0].entity_kind as string) !== "venue") return null;
  return {
    ok: false,
    status: 400,
    error: `${rows[0].name} es un venue. Se puede ser miembro, pero la residencia va en un colectivo.`,
  };
}

/** La residencia que el artista tiene AHORA, si tiene alguna, salvo en este colectivo. */
async function residenciaActual(artistSlug: string, exceptoColectivo: string) {
  const rows = await sql`
    SELECT ac.id, ac.collective_slug, c.name
    FROM artist_collectives ac
    JOIN collectives c ON c.slug = ac.collective_slug
    WHERE ac.artist_slug = ${artistSlug}
      AND ac.kind = 'residente'
      AND ac.to_date IS NULL
      AND ac.accepted_at IS NOT NULL
      AND ac.collective_slug <> ${exceptoColectivo}
  `;
  return rows[0];
}

export type ConflictoDeResidencia = {
  conflict: "residencia";
  actual: { slug: string; name: string };
  destino: { slug: string; name: string };
  /**
   * Las dos únicas salidas, y las dos las elige el DJ:
   *   renunciar — deja la residencia anterior y toma esta. Sigue faltando
   *               decir qué pasa con el vínculo viejo, ver abajo.
   *   rechazar  — se queda donde está y esta oferta muere.
   * NO hay reemplazo automático: cerrar la residencia de alguien no es un
   * efecto secundario de responder otra cosa.
   */
  opciones: Array<
    { respuesta: "renunciar"; anterior: "miembro" | "salir" } | { respuesta: "rechazar" }
  >;
};

export type DecisionDeResidencia =
  | { respuesta: "renunciar"; anterior: "miembro" | "salir" }
  | { respuesta: "rechazar" };

/**
 * EL DUEÑO OFRECE LA RESIDENCIA.
 *
 * Exige que el DJ ya sea miembro ACEPTADO del colectivo. Podría crear la
 * membresía al pasar, y sería peor: serían dos decisiones —"te sumo" y "te doy
 * permiso de editar"— tomadas con un solo clic, y la segunda es la que no se
 * puede tomar por error. Primero se entra, después se ofrece.
 */
export async function ofrecerResidencia(
  collectiveSlug: string,
  artistSlug: string,
  actorEmail?: string | null
): Promise<WriteResult<{ id: number }>> {
  if (!(await puedeAdministrarColectivo(collectiveSlug, actorEmail))) {
    return {
      ok: false,
      status: 403,
      error: "Solo quien administra el colectivo puede ofrecer una residencia",
    };
  }

  const enVenue = await rechazarResidenciaEnVenue(collectiveSlug);
  if (enVenue) return enVenue;

  const artista = await sql`SELECT slug FROM artists WHERE slug = ${artistSlug}`;
  if (artista.length === 0) {
    return { ok: false, status: 404, error: `No existe el artista "${artistSlug}"` };
  }

  const vinculo = await sql`
    SELECT id, kind FROM artist_collectives
    WHERE artist_slug = ${artistSlug} AND collective_slug = ${collectiveSlug}
      AND to_date IS NULL AND accepted_at IS NOT NULL
  `;
  if (vinculo.length === 0) {
    return {
      ok: false,
      status: 409,
      error:
        "Ese DJ todavía no es miembro aceptado del colectivo. Primero entra al colectivo, " +
        "después se le ofrece la residencia.",
    };
  }
  if ((vinculo[0].kind as string) === "residente") {
    return { ok: false, status: 409, error: "Ese DJ ya es residente del colectivo" };
  }

  /**
   * ON CONFLICT DO NOTHING sobre el índice de una-sola-abierta, y después se
   * mira si insertó. Preguntar antes y escribir después deja una ventana de un
   * round-trip en la que entran dos ofertas — y con el driver HTTP de Neon cada
   * consulta es su propio request, así que la ventana es real, no teórica.
   */
  const filas = await sql`
    INSERT INTO residency_offers (artist_slug, collective_slug, offered_by)
    VALUES (${artistSlug}, ${collectiveSlug}, ${actorEmail})
    ON CONFLICT (artist_slug, collective_slug) WHERE resolved_at IS NULL DO NOTHING
    RETURNING id
  `;
  if (filas.length === 0) {
    return { ok: false, status: 409, error: "Ya hay una oferta de residencia sin responder" };
  }
  return { ok: true, value: { id: filas[0].id as number } };
}

/** El dueño se arrepiente antes de que el DJ conteste. */
export async function revocarOferta(
  id: number,
  actorEmail?: string | null
): Promise<WriteResult> {
  const filas = await sql`
    SELECT id, collective_slug, resolved_at FROM residency_offers WHERE id = ${id}`;
  if (filas.length === 0) return { ok: false, status: 404, error: "Esa oferta no existe" };
  if (filas[0].resolved_at) return { ok: false, status: 409, error: "Esa oferta ya fue respondida" };

  if (!(await puedeAdministrarColectivo(filas[0].collective_slug as string, actorEmail))) {
    return { ok: false, status: 403, error: "Esa oferta no es tuya" };
  }

  await sql`
    UPDATE residency_offers SET resolved_at = now(), outcome = 'revoked'
    WHERE id = ${id} AND resolved_at IS NULL`;
  return { ok: true, value: undefined };
}

/**
 * EL DJ RESPONDE.
 *
 * `decision` solo hace falta cuando ya hay otra residencia activa. Sin ella,
 * aceptar con un conflicto abierto devuelve 200 con las opciones y NO TOCA
 * NADA: la oferta queda sin responder y el DJ vuelve a llamar diciendo qué
 * elige. Es la misma forma que ya tenía el conflicto de casa, y por el mismo
 * motivo — cerrar la residencia anterior no puede ser un efecto secundario.
 */
export async function responderOferta(
  id: number,
  respuesta: "aceptar" | "rechazar",
  actorEmail?: string | null,
  decision?: DecisionDeResidencia
): Promise<WriteResult<undefined | ConflictoDeResidencia>> {
  if (respuesta !== "aceptar" && respuesta !== "rechazar") {
    return { ok: false, status: 400, error: "respuesta must be 'aceptar' or 'rechazar'" };
  }

  const filas = await sql`
    SELECT o.id, o.artist_slug, o.collective_slug, o.resolved_at, c.name AS collective_name
    FROM residency_offers o
    JOIN collectives c ON c.slug = o.collective_slug
    WHERE o.id = ${id}
  `;
  if (filas.length === 0) return { ok: false, status: 404, error: "Esa oferta no existe" };
  const oferta = filas[0];
  if (oferta.resolved_at) return { ok: false, status: 409, error: "Esa oferta ya fue respondida" };

  if (!(await esDuenoDelArtista(oferta.artist_slug as string, actorEmail))) {
    return { ok: false, status: 403, error: "Esta oferta la responde el DJ" };
  }

  if (respuesta === "rechazar") {
    await sql`
      UPDATE residency_offers SET resolved_at = now(), outcome = 'declined'
      WHERE id = ${id} AND resolved_at IS NULL`;
    return { ok: true, value: undefined };
  }

  /**
   * La guarda de venue se vuelve a correr ACÁ y no solo al ofrecer. Entre la
   * oferta y la respuesta pueden pasar días, y un colectivo puede haberse
   * convertido en venue en el medio — comparten tabla, así que es un UPDATE de
   * una columna. Validar solo en la puerta de entrada es confiar en que el
   * mundo no se movió.
   */
  const enVenue = await rechazarResidenciaEnVenue(oferta.collective_slug as string);
  if (enVenue) return enVenue;

  /** Y el vínculo tiene que seguir vivo: pudieron sacarlo del colectivo. */
  const vinculo = await sql`
    SELECT id FROM artist_collectives
    WHERE artist_slug = ${oferta.artist_slug} AND collective_slug = ${oferta.collective_slug}
      AND to_date IS NULL AND accepted_at IS NOT NULL
  `;
  if (vinculo.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Ya no sos miembro aceptado de ese colectivo, así que la residencia no aplica",
    };
  }
  const vinculoId = vinculo[0].id as number;

  const actual = await residenciaActual(
    oferta.artist_slug as string,
    oferta.collective_slug as string
  );

  if (actual && !decision) {
    return {
      ok: true,
      value: {
        conflict: "residencia",
        actual: { slug: actual.collective_slug as string, name: actual.name as string },
        destino: {
          slug: oferta.collective_slug as string,
          name: oferta.collective_name as string,
        },
        opciones: [
          { respuesta: "renunciar", anterior: "miembro" },
          { respuesta: "renunciar", anterior: "salir" },
          { respuesta: "rechazar" },
        ],
      },
    };
  }

  if (actual && decision) {
    if (decision.respuesta === "rechazar") {
      await sql`
        UPDATE residency_offers SET resolved_at = now(), outcome = 'declined'
        WHERE id = ${id} AND resolved_at IS NULL`;
      return { ok: true, value: undefined };
    }
    if (decision.anterior !== "miembro" && decision.anterior !== "salir") {
      return {
        ok: false,
        status: 400,
        error: "Al renunciar a la residencia anterior hay que decir qué pasa con ese vínculo: 'miembro' o 'salir'",
      };
    }

    /**
     * TODO EN UNA TRANSACCIÓN, y el orden no es preferencia. A mitad de camino
     * el artista tendría DOS residencias activas, que el índice único rechaza,
     * así que este es el único orden que funciona: primero se cierra la vieja.
     */
    const pasos = [
      sql`UPDATE artist_collectives SET to_date = CURRENT_DATE WHERE id = ${actual.id}`,
    ];
    if (decision.anterior === "miembro") {
      pasos.push(sql`
        INSERT INTO artist_collectives
          (artist_slug, collective_slug, kind, from_date, accepted_at, requested_by)
        VALUES (${oferta.artist_slug}, ${actual.collective_slug}, 'miembro', CURRENT_DATE, now(), 'artist')
      `);
    }
    pasos.push(sql`UPDATE artist_collectives SET kind = 'residente' WHERE id = ${vinculoId}`);
    pasos.push(sql`
      UPDATE residency_offers SET resolved_at = now(), outcome = 'accepted'
      WHERE id = ${id} AND resolved_at IS NULL
    `);
    await sql.transaction(pasos);
    return { ok: true, value: undefined };
  }

  /**
   * Sin conflicto. Igual va en transacción: si el UPDATE del vínculo pasara y
   * la oferta quedara abierta, el DJ sería residente con una oferta pendiente
   * para lo mismo, y aceptarla de nuevo intentaría una segunda residencia.
   */
  await sql.transaction([
    sql`UPDATE artist_collectives SET kind = 'residente' WHERE id = ${vinculoId}`,
    sql`
      UPDATE residency_offers SET resolved_at = now(), outcome = 'accepted'
      WHERE id = ${id} AND resolved_at IS NULL
    `,
  ]);
  return { ok: true, value: undefined };
}

/**
 * LA RESIDENCIA DEL FUNDADOR, que es el único caso sin handshake.
 *
 * Quien abre un colectivo queda residente de entrada, y así era antes de la
 * fase 2 —el fundador entraba como 'casa'—. Bajarlo a miembro sería una
 * regresión visible: el press kit muestra el carrusel de RESIDENTES, y el
 * fundador dejaría de estar ahí. La regla de la transición dice que el estado
 * intermedio no puede ser peor que el de partida.
 *
 * NO HACE FALTA QUE NADIE ACEPTE porque las dos partes son la misma persona:
 * el dueño que ofrece y el DJ que acepta. Un handshake consigo mismo sería un
 * paso que nunca falla, o sea ninguno.
 *
 * PERO ESCRIBE LA FILA DE LA OFERTA IGUAL, ya resuelta como 'accepted'. Por
 * eso vive acá y no en collectives-write: si esto escribiera kind='residente'
 * desde el otro archivo, habría DOS lugares capaces de conceder permiso de
 * edición, y el invariante que hace verificable toda la fase 2 —uno solo—
 * dejaría de valer. Acá el registro queda completo y el invariante se sostiene.
 */
export async function concederResidenciaAlFundador(
  collectiveSlug: string,
  artistSlug: string,
  founderEmail: string
): Promise<WriteResult<{ concedida: boolean }>> {
  /**
   * Se comprueba que sea el dueño AUNQUE el llamador acabe de crear el
   * colectivo. "Solo lo llama createCollective" es una promesa sobre quién
   * importa esta función; la comprobación es una garantía.
   */
  if (!(await puedeAdministrarColectivo(collectiveSlug, founderEmail))) {
    return { ok: false, status: 403, error: "Esa residencia no es tuya para conceder" };
  }

  /** Un venue no es la residencia de nadie, ni siquiera de quien lo abrió. */
  if (await rechazarResidenciaEnVenue(collectiveSlug)) {
    return { ok: true, value: { concedida: false } };
  }

  /** Y si ya tiene residencia en otro lado, esta queda en miembro. Nada se mueve solo. */
  if (await residenciaActual(artistSlug, collectiveSlug)) {
    return { ok: true, value: { concedida: false } };
  }

  const vinculo = await sql`
    SELECT id FROM artist_collectives
    WHERE artist_slug = ${artistSlug} AND collective_slug = ${collectiveSlug}
      AND to_date IS NULL AND accepted_at IS NOT NULL
  `;
  if (vinculo.length === 0) {
    return { ok: false, status: 409, error: "Falta la membresía del fundador" };
  }

  await sql.transaction([
    sql`
      INSERT INTO residency_offers
        (artist_slug, collective_slug, offered_by, resolved_at, outcome)
      VALUES (${artistSlug}, ${collectiveSlug}, ${founderEmail}, now(), 'accepted')
    `,
    sql`UPDATE artist_collectives SET kind = 'residente' WHERE id = ${vinculo[0].id}`,
  ]);
  return { ok: true, value: { concedida: true } };
}

export type OfertaAbierta = {
  id: number;
  artistSlug: string;
  artistName: string;
  collectiveSlug: string;
  collectiveName: string;
  offeredAt: string;
};

/** Lo que el DJ tiene para responder. */
export async function ofertasAbiertasDeArtista(artistSlug: string): Promise<OfertaAbierta[]> {
  const rows = await sql`
    SELECT o.id, o.artist_slug, a.name AS artist_name, o.collective_slug,
           c.name AS collective_name, o.offered_at
    FROM residency_offers o
    JOIN artists a ON a.slug = o.artist_slug
    JOIN collectives c ON c.slug = o.collective_slug
    WHERE o.artist_slug = ${artistSlug} AND o.resolved_at IS NULL
    ORDER BY o.offered_at DESC
  `;
  return rows.map((r) => ({
    id: r.id as number,
    artistSlug: r.artist_slug as string,
    artistName: r.artist_name as string,
    collectiveSlug: r.collective_slug as string,
    collectiveName: r.collective_name as string,
    offeredAt: String(r.offered_at),
  }));
}

/** Lo que el colectivo ofreció y está esperando respuesta. */
export async function ofertasAbiertasDeColectivo(
  collectiveSlug: string
): Promise<OfertaAbierta[]> {
  const rows = await sql`
    SELECT o.id, o.artist_slug, a.name AS artist_name, o.collective_slug,
           c.name AS collective_name, o.offered_at
    FROM residency_offers o
    JOIN artists a ON a.slug = o.artist_slug
    JOIN collectives c ON c.slug = o.collective_slug
    WHERE o.collective_slug = ${collectiveSlug} AND o.resolved_at IS NULL
    ORDER BY o.offered_at DESC
  `;
  return rows.map((r) => ({
    id: r.id as number,
    artistSlug: r.artist_slug as string,
    artistName: r.artist_name as string,
    collectiveSlug: r.collective_slug as string,
    collectiveName: r.collective_name as string,
    offeredAt: String(r.offered_at),
  }));
}
