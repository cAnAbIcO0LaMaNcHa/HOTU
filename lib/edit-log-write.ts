/**
 * QUIÉN EDITÓ QUÉ EN UN COLECTIVO (§8 fase 2).
 *
 * ============================================================
 * ESTO NO ES TELEMETRÍA: ES PARTE DEL PERMISO
 * ============================================================
 *
 * Hasta la fase 2 un colectivo lo editaba solo su dueño, y "quién hizo esto"
 * tenía una sola respuesta posible. Con los residentes editando, la pregunta se
 * vuelve real — y la condición con la que se concedió ese permiso fue que cada
 * edición quedara registrada con su autor.
 *
 * Registra TAMBIÉN al SUPER_ADMIN, que sigue entrando por canEditCollective. Un
 * moderador que edita el colectivo de otro deja el mismo rastro que un
 * residente; lo que NO hace es aparecer en la lista pública de editores, porque
 * no es parte del colectivo.
 *
 * ============================================================
 * NADA SE ESCRIBE SIN REGISTRO. LA REGLA CAMBIÓ, Y VALE DECIR POR QUÉ
 * ============================================================
 *
 * La primera versión se tragaba el error y dejaba la edición en pie, con el
 * argumento de que una edición sin registro es un texto que se ve en la página y
 * se puede volver a hacer, mientras un traspaso sin registro es irreversible.
 *
 * Ese argumento tenía un agujero que apareció al construir /admin/organizadores:
 * un MODERATOR no era ninguno de los tres roles que edit_log conocía, así que
 * rolSobreColectivo le devolvía null y NO SE ESCRIBÍA NADA. Sus ediciones eran
 * invisibles, en silencio, y el mensaje de error culpaba a "una escritura que no
 * pasó por la puerta" cuando la puerta se había pasado perfectamente.
 *
 * O sea que el modo de falla real no era "la tabla está caída": era "hay un
 * actor legítimo que este registro no sabe nombrar". Y contra ESE, tragarse el
 * error es exactamente lo que no hay que hacer, porque no avisa y no se nota.
 *
 * Así que ahora: si el rol no se puede resolver o la fila no se puede escribir,
 * LA EDICIÓN FALLA. Igual que reasignarDueno.
 *
 * Y eso obliga a una forma de uso, no solo a un cambio de retorno:
 *
 *   1. resolverRolParaRegistro() se llama ANTES de escribir nada. Si devuelve
 *      null, el camino se corta con los datos intactos.
 *   2. sentenciaDeRegistro() devuelve el INSERT para meterlo DENTRO de la misma
 *      sql.transaction que el dato. Si el log no entra, el dato tampoco.
 *
 * registrarEdicion() sigue existiendo para el único caso que no puede ser
 * transaccional —/api/upload, donde el blob ya se subió a Vercel y ninguna
 * transacción lo deshace— y ahí devuelve un resultado que el llamador tiene que
 * mirar.
 *
 * ============================================================
 * GUARDA NOMBRES DE CAMPO, NUNCA VALORES
 * ============================================================
 *
 * `campos` dice QUÉ cambió, no qué decía antes ni qué dice ahora. Guardar los
 * valores convertiría esto en una copia del contenido del sitio, con dos
 * costos: crece sin techo, y hereda el problema de retención que mail_outbox ya
 * tiene anotado en deuda. Para "quién tocó la bio el martes" alcanza el nombre
 * del campo; para "qué decía antes" hace falta versionado, que es otra pieza.
 *
 * Node-only. Nunca importar desde un client component.
 */

import { neon } from "@neondatabase/serverless";
import { rolSobreColectivo, type RolSobreColectivo } from "./collectives-gate";
import { isModerator } from "./roles-check";

const sql = neon(process.env.DATABASE_URL!);

export type EntidadEditada =
  | "collective"
  | "event"
  | "news"
  | "set"
  | "track"
  | "genero"
  | "imagen";

export type AccionEditada = "crear" | "editar" | "borrar";

/**
 * Anota una edición. Devuelve el rol con el que se registró, o null si no se
 * pudo registrar — útil para los tests, y para no tener que adivinar después.
 *
 * El rol NO se pasa por parámetro: se resuelve acá con la misma función que usó
 * la puerta para dejar pasar. Si el llamador pudiera decir "soy el dueño", el
 * registro diría lo que el llamador quiso y no lo que era cierto.
 */
/**
 * Los cuatro valores que edit_log.actor_rol acepta.
 *
 * 'moderador' NO sale de rolSobreColectivo, y eso es deliberado: ese primitivo
 * alimenta canEditCollective, así que devolverlo desde ahí le daría a todo
 * MODERATOR permiso para editar el contenido de cualquier colectivo. Un
 * MODERATOR hoy NO lo tiene y no lo gana con esto — lo único que gana es un
 * nombre en el registro.
 */
export type RolRegistrado = RolSobreColectivo | "moderador";

/** Lo que devuelve un intento de registrar: el rol con el que quedó, o por qué no. */
export type ResultadoRegistro =
  | { ok: true; rol: RolRegistrado }
  | { ok: false; status: 403 | 409; error: string };

/**
 * QUIÉN ES ESTA CUENTA A LOS EFECTOS DEL REGISTRO. No es una puerta.
 *
 * Se llama ANTES de escribir, para que un actor que el registro no sabe nombrar
 * corte el camino con los datos todavía intactos.
 *
 * El orden importa y es el de rolSobreColectivo más un escalón: dueño, residente,
 * super_admin, y recién después moderador. Si un SUPER_ADMIN además es el dueño,
 * queda 'dueno' — es su colectivo, no un acto de moderación.
 */
export async function resolverRolParaRegistro(
  collectiveSlug: string,
  actorEmail: string
): Promise<RolRegistrado | null> {
  const rol = await rolSobreColectivo(collectiveSlug, actorEmail);
  if (rol) return rol;
  /**
   * El escalón que faltaba. isModerator es la puerta del panel —la lista de
   * ADMIN_EMAILS o el rol SUPER_ADMIN/MODERATOR— así que cubre al moderador que
   * rolSobreColectivo no ve.
   */
  if (await isModerator(actorEmail)) return "moderador";
  return null;
}

/** El detalle, con los campos ordenados y sin repetir. Nombres, nunca valores. */
function detalleDe(campos?: string[]): string | null {
  return campos && campos.length > 0
    ? JSON.stringify({ campos: [...new Set(campos)].sort() })
    : null;
}

export type DatosDeEdicion = {
  collectiveSlug: string;
  actorEmail: string;
  entidad: EntidadEditada;
  /** El id o slug de lo editado. Para el colectivo mismo, su slug. */
  entidadId: string;
  accion: AccionEditada;
  /** Nombres de campo, nunca valores. Vacío o ausente para crear y borrar. */
  campos?: string[];
};

/**
 * EL INSERT, para meterlo DENTRO de la transacción que escribe el dato.
 *
 * Así "nada se escribe sin registro" deja de ser una promesa sobre el orden de
 * dos awaits y pasa a ser atómico: si el log no entra, el dato tampoco. Es la
 * misma forma que usa reasignarDueno.
 *
 * Recibe el rol ya resuelto en vez de resolverlo: adentro de una transacción no
 * se puede hacer otra consulta con este driver, y además el llamador tiene que
 * haberlo resuelto antes para poder cortar a tiempo.
 */
export function sentenciaDeRegistro(rol: RolRegistrado, d: DatosDeEdicion) {
  return sql`
    INSERT INTO edit_log
      (actor_email, actor_rol, collective_slug, entidad, entidad_id, accion, detalle)
    VALUES (${d.actorEmail}, ${rol}, ${d.collectiveSlug},
            ${d.entidad}, ${d.entidadId}, ${d.accion}, ${detalleDe(d.campos)}::jsonb)
  `;
}

/**
 * Registra una edición POR SU CUENTA, fuera de transacción.
 *
 * Es para el único camino que no puede ser transaccional: /api/upload, donde el
 * blob ya viajó a Vercel y ninguna transacción lo trae de vuelta. Ahí el orden
 * correcto es resolver el rol ANTES de subir —así un actor sin nombre no sube
 * nada— y si el INSERT falla después, el llamador devuelve error y el blob queda
 * huérfano sin que nada lo referencie.
 *
 * DEVUELVE UN RESULTADO QUE HAY QUE MIRAR. No lanza y no se traga nada.
 */
export async function registrarEdicion(d: DatosDeEdicion): Promise<ResultadoRegistro> {
  const rol = await resolverRolParaRegistro(d.collectiveSlug, d.actorEmail);
  if (!rol) {
    /**
     * EL MENSAJE DICE LO QUE PASÓ, y el anterior no: decía "hay una escritura que
     * no pasó por la puerta", que era un mal diagnóstico. La puerta se pasa —por
     * eso el llamador llegó hasta acá— y lo que falla es nombrar al actor.
     */
    const msg =
      `No pude determinar con qué rol registrar esta edición de ${d.collectiveSlug} ` +
      `para ${d.actorEmail}. La edición NO se aplicó: nada se escribe sin registro.`;
    console.error(`[edit_log] ${msg}`);
    return { ok: false, status: 403, error: msg };
  }

  try {
    await sentenciaDeRegistro(rol, d);
    return { ok: true, rol };
  } catch (e) {
    const msg =
      "No pude registrar esta edición, así que no la doy por hecha. " +
      "Probá de nuevo; si sigue, es la tabla de auditoría.";
    console.error("[edit_log] no se pudo escribir el registro:", e);
    return { ok: false, status: 409, error: msg };
  }
}

export type Edicion = {
  id: number;
  actorEmail: string;
  actorRol: RolSobreColectivo;
  entidad: string;
  entidadId: string;
  accion: string;
  campos: string[];
  creadoEn: string;
};

/** El historial de un colectivo, lo más nuevo primero. */
export async function historialDeColectivo(
  collectiveSlug: string,
  limite = 100
): Promise<Edicion[]> {
  const rows = await sql`
    SELECT id, actor_email, actor_rol, entidad, entidad_id, accion, detalle, creado_en
    FROM edit_log
    WHERE collective_slug = ${collectiveSlug}
    ORDER BY creado_en DESC
    LIMIT ${Math.min(Math.max(1, limite), 500)}
  `;
  return rows.map((r) => ({
    id: r.id as number,
    actorEmail: r.actor_email as string,
    actorRol: r.actor_rol as RolSobreColectivo,
    entidad: r.entidad as string,
    entidadId: r.entidad_id as string,
    accion: r.accion as string,
    campos: ((r.detalle as { campos?: string[] } | null)?.campos ?? []) as string[],
    creadoEn: String(r.creado_en),
  }));
}

/*
 * editoresPublicos() SE BORRÓ ANTES DE NACER, y vale decir por qué.
 *
 * La iba a escribir para garantizar que el SUPER_ADMIN no figure en la lista
 * pública de editores. Al mirarlo, esa lista YA EXISTE: es el carrusel
 * RESIDENTES de /colectivos/[slug], que sale de artist_collectives. Y el
 * SUPER_ADMIN no puede aparecer ahí POR CONSTRUCCIÓN — no tiene fila en esa
 * tabla, entra por isSuperAdmin y por ningún vínculo.
 *
 * O sea que la garantía no necesitaba código nuevo: necesitaba una medición de
 * algo que ya era cierto. Está en la batería de residencias, que verifica que un
 * SUPER_ADMIN pueda editar un colectivo ajeno Y que no aparezca en su roster.
 *
 * Se borra y no se deja sin uso por lo mismo que recalcMembership y addMember:
 * una segunda función que devuelve "quiénes pueden editar" es una que alguien va
 * a llamar creyendo que es la fuente de verdad, y entonces habría dos.
 */
