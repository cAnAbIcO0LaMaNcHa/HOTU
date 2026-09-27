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
 * NUNCA REVIENTA, Y ESO ES UNA DECISIÓN
 * ============================================================
 *
 * Si el INSERT falla, se traga el error y la edición sigue en pie. Es lo
 * contrario de lo que hace reasignarDueno —que aborta el traspaso si no puede
 * escribir su fila de auditoría— y la diferencia es deliberada:
 *
 *   un traspaso SIN registro es irreversible y no se puede reconstruir, así que
 *   más vale no hacerlo;
 *   una edición sin registro es un cambio de texto que se ve en la página y se
 *   puede volver a hacer.
 *
 * Perder el registro de una edición es malo. Que alguien no pueda arreglar la
 * bio de su colectivo porque una tabla de auditoría está caída es peor. La
 * asimetría es entre "no se puede deshacer" y "se ve en la pantalla".
 *
 * Lo que NO se hace es fallar en silencio del todo: el error va a console.error
 * para que quede en los logs del servidor.
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
export async function registrarEdicion(opciones: {
  collectiveSlug: string;
  actorEmail: string;
  entidad: EntidadEditada;
  /** El id o slug de lo editado. Para el colectivo mismo, su slug. */
  entidadId: string;
  accion: AccionEditada;
  /** Nombres de campo, nunca valores. Vacío o ausente para crear y borrar. */
  campos?: string[];
}): Promise<RolSobreColectivo | null> {
  try {
    const rol = await rolSobreColectivo(opciones.collectiveSlug, opciones.actorEmail);
    if (!rol) {
      /**
       * Sin rol no hay nada que registrar, y llegar acá significa que algo pasó
       * la puerta sin pasarla. Se avisa fuerte en vez de escribir una fila que
       * mentiría sobre quién es esta persona.
       */
      console.error(
        `[edit_log] ${opciones.actorEmail} editó ${opciones.collectiveSlug} sin rol sobre él. ` +
          "Esto no debería poder pasar: hay una escritura que no pasó por la puerta."
      );
      return null;
    }

    const detalle =
      opciones.campos && opciones.campos.length > 0
        ? JSON.stringify({ campos: [...new Set(opciones.campos)].sort() })
        : null;

    await sql`
      INSERT INTO edit_log
        (actor_email, actor_rol, collective_slug, entidad, entidad_id, accion, detalle)
      VALUES (${opciones.actorEmail}, ${rol}, ${opciones.collectiveSlug},
              ${opciones.entidad}, ${opciones.entidadId}, ${opciones.accion},
              ${detalle}::jsonb)
    `;
    return rol;
  } catch (e) {
    console.error("[edit_log] no se pudo registrar la edición:", e);
    return null;
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
