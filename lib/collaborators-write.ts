/**
 * Colaboradores en un set o un track (TANDA-3 §6.1).
 *
 * TENER COLABORADORES ES LO QUE MARCA LA PIEZA COMO FIJA. Una pieza fija
 * no migra nunca: se queda donde se publicó, aunque su autor cambie de
 * casa cinco veces. Una pieza sin colaboradores no tiene ni una fila en
 * content_placements y vive en la casa ACTUAL de su autor, derivada cada
 * vez que alguien mira.
 *
 * EL COLABORADOR TIENE QUE ACEPTAR. Sin eso, publicar un track diciendo
 * que lo hiciste con alguien lo pondría en el perfil de la casa de esa
 * persona sin que opine. Es la misma forma del problema que ya resolvió
 * membresías —"un colectivo no puede listar a un DJ que nunca dijo que
 * sí"— y la misma solución. Hasta que acepte, la pieza se ve solo en la
 * casa del autor.
 *
 * CADA DESTINO SE CONGELA CUANDO ESA PARTE ENTRA, no todos al publicar:
 * el del autor al publicar, el de cada colaborador al aceptar, con la
 * casa que tenga EN ESE MOMENTO. Es lo honesto: consentiste estando en
 * esa casa. Y evita tener que inventar qué pasa si alguien acepta seis
 * meses después de que lo invitaron.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import type { WriteResult } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

/** Un invitado: o un artista, o un colectivo. Nunca los dos. */
export type ColaboradorInput = {
  artistSlug?: unknown;
  collectiveSlug?: unknown;
};

export type ColaboradorOk = { artistSlug: string | null; collectiveSlug: string | null };

/** Como máximo, para que una pieza no se convierta en una lista de correo. */
export const MAX_COLABORADORES = 10;

/**
 * La casa ACTIVA de un artista, o null.
 *
 * Es lo que se congela como destino. Un artista sin casa devuelve null y
 * eso NO es un error: se puede publicar igual. Lo que no se puede es
 * arreglarlo después, y por eso la UI tiene que avisarlo antes (ver
 * `avisoSinCasa`).
 */
export async function casaActual(artistSlug: string): Promise<string | null> {
  const filas = await sql`
    SELECT collective_slug FROM artist_collectives
    WHERE artist_slug = ${artistSlug}
      AND kind = 'casa' AND to_date IS NULL AND accepted_at IS NOT NULL
    LIMIT 1
  `;
  return (filas[0]?.collective_slug as string | undefined) ?? null;
}

/**
 * El aviso que la UI muestra al publicar una colaboración sin tener casa.
 *
 * Dice la consecuencia COMPLETA, no la mitad. "Todavía no tenés casa" no
 * alcanza: quien lo lee asume que la pieza va a entrar sola cuando entre
 * a un colectivo, y no va a entrar nunca, porque una pieza con
 * colaboradores es fija y lo fijo no migra.
 */
export const AVISO_SIN_CASA =
  "Todavía no tenés una casa, así que esta pieza NO va a aparecer en ningún colectivo — " +
  "ni ahora, ni cuando entres a uno. Las piezas con colaboradores quedan fijas donde se " +
  "publican, y no se mueven después.";

/**
 * Valida la lista de invitados.
 *
 * TRES GUARDAS QUE EL SCHEMA NO PUEDE HACER CUMPLIR, porque las tres
 * miran filas de otra tabla y un CHECK no puede:
 *
 * 1. EL AUTOR NO SE INVITA A SÍ MISMO. No rompe nada en la base, pero el
 *    placement del autor ya se escribe solo al publicar, así que
 *    invitarse duplicaría el intento y además pediría que uno se acepte
 *    a sí mismo para que pase algo.
 * 2. UN VENUE NO ES COLABORADOR. §6.1 dice "artistas o colectivos", y un
 *    venue vive en la MISMA tabla que los colectivos distinguiéndose
 *    solo por entity_kind, que ningún FK ve. Es exactamente la forma del
 *    bug de la casa-en-venue. Y es la misma decisión de fondo que ya
 *    tomamos dos veces: un venue no es la casa de nadie, y el género lo
 *    tiene la fiesta y no el lugar. La música no es de un lugar.
 * 3. NO SE PUEDE INVITAR A ALGO QUE NO EXISTE O NO ESTÁ PUBLICADO. El FK
 *    atajaría lo inexistente, pero "no existe ese artista" se entiende y
 *    "violates foreign key constraint" no.
 */
export async function validarColaboradores(
  autorSlug: string,
  entrada: unknown
): Promise<WriteResult<ColaboradorOk[]>> {
  if (entrada === undefined || entrada === null) return { ok: true, value: [] };
  if (!Array.isArray(entrada)) {
    return { ok: false, status: 400, error: "collaborators tiene que ser una lista" };
  }
  if (entrada.length > MAX_COLABORADORES) {
    return { ok: false, status: 400, error: `Como máximo ${MAX_COLABORADORES} colaboradores` };
  }

  const vistos = new Set<string>();
  const limpios: ColaboradorOk[] = [];
  for (const c of entrada as ColaboradorInput[]) {
    const a = typeof c?.artistSlug === "string" ? c.artistSlug.trim() : "";
    const k = typeof c?.collectiveSlug === "string" ? c.collectiveSlug.trim() : "";
    if ((a === "") === (k === "")) {
      return {
        ok: false,
        status: 400,
        error: "Cada colaborador es un artista O un colectivo, no los dos ni ninguno",
      };
    }
    if (a && a === autorSlug) {
      return {
        ok: false,
        status: 400,
        error: "No hace falta que te invites: la pieza ya es tuya y va a tu casa sola",
      };
    }
    const clave = a ? `a:${a}` : `c:${k}`;
    if (vistos.has(clave)) {
      return { ok: false, status: 400, error: "Hay un colaborador repetido" };
    }
    vistos.add(clave);
    limpios.push({ artistSlug: a || null, collectiveSlug: k || null });
  }

  // --- que existan, estén publicados, y no sean venues ---------------
  const artistas = limpios.map((c) => c.artistSlug).filter(Boolean) as string[];
  if (artistas.length > 0) {
    const hay = await sql`
      SELECT slug FROM artists
      WHERE slug = ANY(${artistas}::text[]) AND status = 'published'
    `;
    const encontrados = new Set(hay.map((r) => r.slug as string));
    const faltan = artistas.filter((s) => !encontrados.has(s));
    if (faltan.length > 0) {
      return { ok: false, status: 400, error: `No existen estos artistas: ${faltan.join(", ")}` };
    }
  }

  const colectivos = limpios.map((c) => c.collectiveSlug).filter(Boolean) as string[];
  if (colectivos.length > 0) {
    const hay = await sql`
      SELECT slug, entity_kind FROM collectives
      WHERE slug = ANY(${colectivos}::text[]) AND status = 'published'
    `;
    const porSlug = new Map(hay.map((r) => [r.slug as string, r.entity_kind as string]));
    const faltan = colectivos.filter((s) => !porSlug.has(s));
    if (faltan.length > 0) {
      return { ok: false, status: 400, error: `No existen estos colectivos: ${faltan.join(", ")}` };
    }
    const venues = colectivos.filter((s) => porSlug.get(s) === "venue");
    if (venues.length > 0) {
      return {
        ok: false,
        status: 400,
        error: `Un venue no colabora en una pieza: la música es de quien la hace, no del lugar donde suena (${venues.join(", ")})`,
      };
    }
  }

  return { ok: true, value: limpios };
}

/**
 * Las sentencias que acompañan al INSERT de la pieza, para meterlas en la
 * MISMA transacción.
 *
 * Devuelve queries en vez de ejecutarlas, y eso es el punto entero:
 * publicar una colaboración son tres escrituras, y cada sql del driver
 * HTTP de Neon es su propio request. Si la tercera falla por un timeout,
 * la pieza queda con is_fixed=true y CERO placements, que es el estado
 * invisible: no entra por el camino vivo porque is_fixed la excluye, ni
 * por el fijo porque no tiene filas. Publicada, editable por su dueño, y
 * sin existir para nadie más, sin un error en ningún log.
 *
 * Por eso van todas juntas o no va ninguna.
 */
export function sentenciasDeColaboracion(
  tabla: "set" | "track",
  piezaSlug: string,
  colaboradores: ColaboradorOk[],
  casaDelAutor: string | null
) {
  const col = tabla === "set" ? "set_slug" : "track_slug";
  const queries = [
    sql(`UPDATE ${tabla === "set" ? "dj_sets" : "tracks"} SET is_fixed = true WHERE slug = $1`, [
      piezaSlug,
    ]),
  ];

  // El destino del autor, congelado ahora con la casa que tiene hoy.
  // Sin casa no hay fila, y como la pieza es fija no la va a haber nunca.
  if (casaDelAutor) {
    queries.push(
      sql(
        `INSERT INTO content_placements (${col}, collective_slug) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [piezaSlug, casaDelAutor]
      )
    );
  }

  for (const c of colaboradores) {
    queries.push(
      sql(
        `INSERT INTO content_collaborators (${col}, artist_slug, collective_slug)
         VALUES ($1, $2, $3)`,
        [piezaSlug, c.artistSlug, c.collectiveSlug]
      )
    );
  }

  return queries;
}

/**
 * Acepta una invitación y congela el destino de quien acepta.
 *
 * El INSERT del placement lleva ON CONFLICT DO NOTHING, y no es
 * decorativo: si quien acepta comparte casa con el autor, esa fila ya
 * existe desde que se publicó, y el índice único la rechazaría. Sin el
 * ON CONFLICT la aceptación devolvería 500 DESPUÉS de que la persona ya
 * dijo que sí, que es la peor forma de fallar.
 *
 * Las dos escrituras van en una transacción por lo mismo de siempre:
 * aceptar sin que se escriba el placement deja la invitación aceptada y
 * la pieza sin aparecer en ningún lado.
 */
export async function aceptarColaboracion(
  id: number,
  email: string
): Promise<WriteResult<{ aceptada: true; colectivo: string | null }>> {
  const permiso = await puedeResponder(id, email);
  if (!permiso.ok) return permiso;
  const fila = permiso.value;

  if (fila.accepted_at) {
    return { ok: true, value: { aceptada: true, colectivo: null } };
  }

  // A dónde va: si el invitado es un artista, su casa de HOY. Si es un
  // colectivo, el colectivo mismo.
  const destino = fila.artist_slug
    ? await casaActual(fila.artist_slug as string)
    : (fila.collective_slug as string);

  const col = fila.set_slug ? "set_slug" : "track_slug";
  const piezaSlug = (fila.set_slug ?? fila.track_slug) as string;

  const queries = [
    sql(`UPDATE content_collaborators SET accepted_at = now(), declined_at = NULL WHERE id = $1`, [
      id,
    ]),
  ];
  if (destino) {
    queries.push(
      sql(
        `INSERT INTO content_placements (${col}, collective_slug) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [piezaSlug, destino]
      )
    );
  }
  await sql.transaction(queries);

  return { ok: true, value: { aceptada: true, colectivo: destino } };
}

/**
 * Rechaza la invitación.
 *
 * Marca declined_at en vez de borrar la fila. Borrar dejaría al autor
 * re-invitando infinitas veces a quien ya dijo que no, porque el índice
 * único solo protege mientras la fila exista. Con declined_at la
 * invitación rechazada se conserva —el histórico es inmutable, igual que
 * en artist_collectives— y se puede volver a invitar UNA vez, porque los
 * índices únicos parciales excluyen las rechazadas.
 *
 * No toca placements: si ya había aceptado y después rechaza, la pieza YA
 * ESTUVO publicada ahí. Retirar el crédito no reescribe que ocurrió.
 */
export async function rechazarColaboracion(
  id: number,
  email: string
): Promise<WriteResult<{ rechazada: true }>> {
  const permiso = await puedeResponder(id, email);
  if (!permiso.ok) return permiso;

  await sql`
    UPDATE content_collaborators SET declined_at = now(), accepted_at = NULL WHERE id = ${id}
  `;
  return { ok: true, value: { rechazada: true } };
}

/**
 * ¿Esta cuenta es la invitada?
 *
 * Responde 404 y no 403 cuando la invitación no es suya: contestar "esa
 * invitación existe pero no es tuya" deja enumerar invitaciones ajenas
 * probando ids. Es la misma razón por la que un borrador ajeno da 404.
 */
async function puedeResponder(
  id: number,
  email: string
): Promise<WriteResult<Record<string, unknown>>> {
  const filas = await sql`
    SELECT cc.*
    FROM content_collaborators cc
    LEFT JOIN artists a ON a.slug = cc.artist_slug
    LEFT JOIN collectives c ON c.slug = cc.collective_slug
    WHERE cc.id = ${id}
      AND (lower(a.owner_email) = lower(${email}) OR lower(c.owner_email) = lower(${email}))
  `;
  if (filas.length === 0) {
    return { ok: false, status: 404, error: "Esa invitación no existe" };
  }
  return { ok: true, value: filas[0] };
}
