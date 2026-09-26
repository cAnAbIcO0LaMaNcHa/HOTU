/**
 * ELIMINAR UNA CUENTA (§8).
 *
 * La única acción de moderación que no se deshace. El ban se levanta, la
 * censura se levanta, un traspaso se vuelve a traspasar. Esto no.
 *
 * ============================================================
 * ELIMINAR DESENGANCHA, NO DESTRUYE
 * ============================================================
 *
 * Lo que se borra de verdad es lo que no significa nada sin la persona:
 * sus likes y sus roles. Todo lo demás SE QUEDA y pierde el vínculo,
 * porque HOTU es un archivo: un colectivo con miembros, un evento al que
 * fue gente y una noticia que alguien leyó no dejan de haber existido
 * porque el dueño de la cuenta se vaya.
 *
 * Eso no lo decide este archivo: lo decide el SCHEMA, que es donde una
 * regla así no se puede olvidar. Medido contra la base, no supuesto:
 *
 *   CASCADE  — artist_likes, collective_likes, user_roles. Se van.
 *   SET NULL — artists.owner_email, collectives.owner_email, y todas las
 *              marcas de moderación (censored_by, reviewed_by,
 *              banned_by) y profile_ownership.from_email/to_email.
 *              El perfil queda DESAMPARADO y sigue en pie.
 *   RESTRICT — orders y tickets. La base NIEGA borrar una cuenta que
 *              tenga pedidos o boletas.
 *
 * Ese RESTRICT es el que importa: una boleta es prueba de un pago. Lo
 * que hay que hacer con esa cuenta es BANEARLA, que ahora es de verdad
 * reversible y no borra nada.
 *
 * ============================================================
 * LA ÚNICA EXCEPCIÓN: LA LIMPIEZA PRE-LANZAMIENTO
 * ============================================================
 *
 * Antes de abrir al público hay que sacar las cuentas de prueba, y esas
 * SÍ tienen pedidos y boletas —de prueba—. El mecanismo para eso no es
 * una excepción al RESTRICT: es el ORDEN. Se borran las atribuciones,
 * después las boletas, después los ítems, después los pedidos, y recién
 * ahí la cuenta sale sola sin que ningún constraint se entere.
 *
 * O sea: el RESTRICT nunca se afloja. Sigue intacto todo el tiempo, y lo
 * que la limpieza hace es sacar de adelante lo que él protege, a la
 * vista y contándolo.
 *
 * Para llegar a ese camino hacen falta TRES cosas a la vez, y son
 * independientes entre sí a propósito:
 *
 *   1. modo "limpieza", que solo la ruta de limpieza pide.
 *   2. Un SUPER_ADMIN, no un moderador cualquiera.
 *   3. LIMPIEZA_PRELANZAMIENTO=1 en el entorno.
 *
 * La tercera es la que se apaga el día del lanzamiento, sin tocar
 * código: se saca la variable y el camino deja de existir. Y las tres se
 * comprueban ACÁ además de en la ruta, porque separar el borrado
 * peligroso "en otro archivo" es una promesa, y esto es una garantía.
 */

import { neon } from "@neondatabase/serverless";
import { isModerator, isSuperAdmin } from "./roles-check";
import { isAdminEmail } from "./admin-emails";
import { limpiarTexto, recortar } from "./texto";
import { actividadDeCuenta, esCuentaFantasma } from "./accounts";
import type { WriteResult } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

/**
 * ¿Modera, sin importar cómo esté escrito el email?
 *
 * isModerator compara `email = $1` EXACTO, y acá siempre llega en
 * minúsculas. Hoy eso coincide —user_profiles guarda normalizado, el FK
 * nuevo obliga a user_roles a coincidir carácter a carácter, y la
 * migración midió cero diferencias de mayúsculas—, así que las dos
 * preguntas dan lo mismo.
 *
 * Igual se pregunta con lower() de los dos lados, porque de lo que
 * depende la respuesta es de si esta cuenta se puede ELIMINAR, y eso no
 * se deshace. Un permiso que se esquiva escribiendo una mayúscula no es
 * un permiso, y acá el costo de equivocarse es borrar a un moderador.
 */
async function moderaDeVerdad(email: string): Promise<boolean> {
  if (isAdminEmail(email)) return true;
  if (await isModerator(email)) return true;
  const rows = await sql`
    SELECT 1 FROM user_roles
    WHERE lower(email) = lower(${email}) AND role IN ('SUPER_ADMIN', 'MODERATOR')
  `;
  return rows.length > 0;
}

/**
 * ¿Está abierta la limpieza pre-lanzamiento?
 *
 * Se lee en cada llamada y no una vez al importar el módulo: en un
 * entorno serverless una instancia puede vivir horas, y "lo apagué y
 * sigue andando" es exactamente la clase de sorpresa que un interruptor
 * de seguridad no puede dar.
 *
 * El default es APAGADO. Hay que encenderlo a mano para que exista.
 */
export function limpiezaHabilitada(): boolean {
  return process.env.LIMPIEZA_PRELANZAMIENTO === "1";
}

/** Qué pasa con los perfiles que la cuenta administraba. */
export type DestinoPerfiles = "desamparar" | "ocultar";

export function esDestinoPerfiles(v: unknown): v is DestinoPerfiles {
  return v === "desamparar" || v === "ocultar";
}

export type ModoBorrado = "normal" | "limpieza";

type PerfilQueQueda = { slug: string; name: string; censurado: boolean };

/**
 * TODO lo que le va a pasar a una cuenta si se la elimina, medido antes
 * de tocar nada.
 *
 * Es la vista previa Y la base del registro. Una sola función para las
 * dos cosas: una vista previa que se calcula distinto de lo que después
 * se ejecuta es una vista previa que miente, y acá lo que promete es
 * irreversible.
 */
export type InventarioCuenta = {
  email: string;
  baneada: boolean;
  esModerador: boolean;
  /** No puede entrar por ninguna vía y no dejó rastro. Ver lib/accounts. */
  fantasma: boolean;

  /* Lo que se borra con ella, por CASCADE. */
  likes: number;
  roles: string[];

  /* Lo que la BLOQUEA, salvo en la limpieza pre-lanzamiento. */
  pedidos: number;
  boletas: number;
  itemsDePedido: number;
  atribuciones: number;
  montoCop: number;
  /** A qué artistas les cuentan esas boletas como venta suya. */
  vendedores: string[];

  /* Lo que SE QUEDA y pierde el vínculo. */
  artistas: PerfilQueQueda[];
  colectivos: PerfilQueQueda[];
  setsYTracks: number;
  /** censored_by, reviewed_by y banned_by que pasan a NULL. */
  marcasDeModeracion: number;
  /** Cesiones abiertas que quedan sin quién las responda. */
  cesionesAbiertas: number;
};

export async function inventarioDeCuenta(emailCrudo: unknown): Promise<InventarioCuenta | null> {
  const email = limpiarTexto(emailCrudo).toLowerCase();
  if (!email) return null;

  const [cuenta] = await sql`
    SELECT email, banned_at FROM user_profiles WHERE lower(email) = ${email}
  `;
  if (!cuenta) return null;

  const actividad = await actividadDeCuenta(email);

  const [c] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM artist_likes WHERE lower(user_email) = ${email})
      + (SELECT COUNT(*)::int FROM collective_likes WHERE lower(user_email) = ${email}) AS likes,
      (SELECT COUNT(*)::int FROM orders WHERE lower(user_email) = ${email}) AS pedidos,
      (SELECT COUNT(*)::int FROM tickets WHERE lower(user_email) = ${email}) AS boletas,
      (SELECT COUNT(*)::int FROM order_items oi
        JOIN orders o ON o.id = oi.order_id WHERE lower(o.user_email) = ${email}) AS items,
      (SELECT COUNT(*)::int FROM ticket_attributions ta
        JOIN tickets t ON t.id = ta.ticket_id WHERE lower(t.user_email) = ${email}) AS atribuciones,
      (SELECT COALESCE(SUM(amount_cop), 0)::bigint FROM orders WHERE lower(user_email) = ${email}) AS monto,
      (SELECT COUNT(*)::int FROM profile_ownership
        WHERE (lower(to_email) = ${email} OR lower(from_email) = ${email})
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL) AS cesiones
  `;

  /**
   * Las marcas de moderación, contadas una por una.
   *
   * Son nueve columnas en siete tablas, todas ON DELETE SET NULL. No las
   * borra nadie: se quedan sin nombre. Que aparezcan en la vista previa
   * es el punto — borrar la cuenta de un moderador deja censuras sin
   * responsable, y eso se tiene que ver ANTES.
   */
  const [m] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM artists WHERE lower(censored_by) = ${email})
      + (SELECT COUNT(*)::int FROM artists WHERE lower(reviewed_by) = ${email})
      + (SELECT COUNT(*)::int FROM collectives WHERE lower(censored_by) = ${email})
      + (SELECT COUNT(*)::int FROM events WHERE lower(censored_by) = ${email})
      + (SELECT COUNT(*)::int FROM news WHERE lower(censored_by) = ${email})
      + (SELECT COUNT(*)::int FROM news WHERE lower(reviewed_by) = ${email})
      + (SELECT COUNT(*)::int FROM dj_sets WHERE lower(censored_by) = ${email})
      + (SELECT COUNT(*)::int FROM tracks WHERE lower(censored_by) = ${email})
      + (SELECT COUNT(*)::int FROM user_profiles WHERE lower(banned_by) = ${email}) AS marcas
  `;

  const artistas = await sql`
    SELECT slug, name, censored_at FROM artists WHERE lower(owner_email) = ${email} ORDER BY slug
  `;
  const colectivos = await sql`
    SELECT slug, name, censored_at FROM collectives WHERE lower(owner_email) = ${email} ORDER BY slug
  `;
  const [st] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM dj_sets s
        JOIN artists a ON a.slug = s.artist_slug WHERE lower(a.owner_email) = ${email})
      + (SELECT COUNT(*)::int FROM tracks t
        JOIN artists a ON a.slug = t.artist_slug WHERE lower(a.owner_email) = ${email}) AS n
  `;
  const vendedores = await sql`
    SELECT DISTINCT ta.seller_artist_slug AS slug
    FROM ticket_attributions ta JOIN tickets t ON t.id = ta.ticket_id
    WHERE lower(t.user_email) = ${email} AND ta.seller_artist_slug IS NOT NULL
    ORDER BY 1
  `;
  const roles = await sql`
    SELECT role FROM user_roles WHERE lower(email) = ${email} ORDER BY role
  `;

  return {
    email: cuenta.email as string,
    baneada: cuenta.banned_at !== null,
    esModerador: await moderaDeVerdad(email),
    fantasma: actividad ? esCuentaFantasma(actividad) : false,
    likes: Number(c.likes ?? 0),
    roles: roles.map((r) => r.role as string),
    pedidos: Number(c.pedidos ?? 0),
    boletas: Number(c.boletas ?? 0),
    itemsDePedido: Number(c.items ?? 0),
    atribuciones: Number(c.atribuciones ?? 0),
    montoCop: Number(c.monto ?? 0),
    vendedores: vendedores.map((v) => v.slug as string),
    artistas: artistas.map((a) => ({
      slug: a.slug as string,
      name: a.name as string,
      censurado: a.censored_at !== null,
    })),
    colectivos: colectivos.map((x) => ({
      slug: x.slug as string,
      name: x.name as string,
      censurado: x.censored_at !== null,
    })),
    setsYTracks: Number(st.n ?? 0),
    marcasDeModeracion: Number(m.marcas ?? 0),
    cesionesAbiertas: Number(c.cesiones ?? 0),
  };
}

/**
 * El mínimo que tiene que decir un motivo. Mismo umbral que el ban y la
 * censura, y por lo mismo: acá es lo ÚNICO que va a quedar. La persona
 * ya no está para preguntarle.
 */
function validarMotivo(note: unknown): { motivo: string } | { error: string } {
  const motivo = limpiarTexto(note);
  if (motivo.length < 10) {
    return { error: "El motivo tiene que explicar qué pasó: al menos 10 caracteres" };
  }
  return { motivo: recortar(motivo, 2000) };
}

/**
 * Una consulta tal como la acepta sql.transaction.
 *
 * Sale del tipo del propio driver y no de `ReturnType<typeof sql>`: ese
 * es más ancho —contempla las variantes de sql() fuera de transacción— y
 * no compila al pasarlo a transaction().
 */
type ConsultaTx = Extract<Parameters<typeof sql.transaction>[0], readonly unknown[]>[number];

/** Un paso de la transacción, con nombre para poder leer su resultado. */
type Paso = { clave: string; q: ConsultaTx };

export type OpcionesEliminar = {
  destinoPerfiles: DestinoPerfiles;
  /** SOLO la limpieza. Borra atribuciones, boletas, ítems y pedidos. */
  borrarComercio: boolean;
};

export type ResultadoEliminar = {
  eliminada: true;
  registroId: number;
  /** Lo que de verdad se borró, contado con RETURNING. */
  medido: Record<string, number>;
  /** null si el borrado commiteó pero el conteo no se pudo guardar. */
  registroCompleto: boolean;
};

/**
 * Elimina la cuenta.
 *
 * TODO pasa en UNA transacción, y el registro entra PRIMERO dentro de
 * ella. Si el borrado falla, el registro se va con él; si el borrado
 * sale, el registro ya está. No existe el estado en el que una cuenta
 * desaparece sin fila que lo cuente — que es justo el estado que haría
 * inútil tener un registro.
 */
export async function eliminarCuenta(
  emailCrudo: unknown,
  motivoCrudo: unknown,
  opciones: OpcionesEliminar,
  actorEmail: string | null | undefined,
  modo: ModoBorrado
): Promise<WriteResult<ResultadoEliminar>> {
  /* ---------- las tres llaves del camino peligroso ---------- */
  if (!actorEmail) return { ok: false, status: 403, error: "Not signed in" };

  if (modo === "limpieza") {
    if (!limpiezaHabilitada()) {
      return {
        ok: false,
        status: 403,
        error: "La limpieza pre-lanzamiento está cerrada (falta LIMPIEZA_PRELANZAMIENTO=1)",
      };
    }
    if (!(await isSuperAdmin(actorEmail))) {
      return { ok: false, status: 403, error: "La limpieza pre-lanzamiento es de un SUPER_ADMIN" };
    }
  } else if (!(await isModerator(actorEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador elimina cuentas" };
  }

  /**
   * Y el borrado normal NUNCA toca plata, ni por error de quien llame.
   *
   * Esto es lo que hace que la separación sea una garantía y no una
   * convención: aunque alguien mande borrarComercio desde la ruta
   * normal, acá se frena.
   */
  if (opciones.borrarComercio && modo !== "limpieza") {
    return {
      ok: false,
      status: 400,
      error: "Borrar pedidos y boletas es exclusivo de la limpieza pre-lanzamiento",
    };
  }
  if (!esDestinoPerfiles(opciones.destinoPerfiles)) {
    return { ok: false, status: 400, error: "destinoPerfiles tiene que ser 'desamparar' u 'ocultar'" };
  }

  const email = limpiarTexto(emailCrudo).toLowerCase();
  if (!email) return { ok: false, status: 400, error: "Falta la cuenta" };

  const v = validarMotivo(motivoCrudo);
  if ("error" in v) return { ok: false, status: 400, error: v.error };

  /**
   * NADIE SE BORRA A SÍ MISMO, NI BORRA A OTRO MODERADOR.
   *
   * Mismas dos razones que el ban, pero sin vuelta atrás: lo primero
   * deja el panel sin quien lo atienda y no se puede deshacer; lo
   * segundo convierte una pelea entre moderadores en una eliminación
   * permanente para el que apriete primero. Sacarle el rol es una
   * decisión de ROLES, que es de un SUPER_ADMIN.
   */
  if (email === actorEmail.toLowerCase()) {
    return { ok: false, status: 400, error: "No podés eliminar tu propia cuenta" };
  }

  const inv = await inventarioDeCuenta(email);
  if (!inv) return { ok: false, status: 404, error: "Esa cuenta no existe" };
  if (inv.esModerador) {
    return {
      ok: false,
      status: 409,
      error:
        "Esa cuenta modera. Sacale el rol desde ROLES —que es de un SUPER_ADMIN— antes de eliminarla.",
    };
  }

  /**
   * El bloqueo por plata, explicado ANTES de que Postgres lo tire crudo.
   *
   * El RESTRICT lo impediría igual: esto no reemplaza la guarda, la
   * TRADUCE. Un foreign_key_violation en pantalla no le dice a nadie que
   * lo que corresponde es banear.
   */
  if (!opciones.borrarComercio && (inv.pedidos > 0 || inv.boletas > 0)) {
    return {
      ok: false,
      status: 409,
      error:
        `Esta cuenta tiene ${inv.pedidos} pedido(s) y ${inv.boletas} boleta(s): son prueba de un pago ` +
        "y no se borran. Lo que corresponde es BANEARLA, que se deshace y no borra nada.",
    };
  }

  /* ---------- el plan, que es lo que la vista previa mostró ---------- */
  const plan: Record<string, number> = {
    likes: inv.likes,
    roles: inv.roles.length,
    artistas: inv.artistas.length,
    colectivos: inv.colectivos.length,
    sets_y_tracks: inv.setsYTracks,
    marcas_de_moderacion: inv.marcasDeModeracion,
    cesiones_abiertas: inv.cesionesAbiertas,
    pedidos: opciones.borrarComercio ? inv.pedidos : 0,
    boletas: opciones.borrarComercio ? inv.boletas : 0,
    items_de_pedido: opciones.borrarComercio ? inv.itemsDePedido : 0,
    atribuciones: opciones.borrarComercio ? inv.atribuciones : 0,
    monto_cop: opciones.borrarComercio ? inv.montoCop : 0,
  };

  const ocultar = opciones.destinoPerfiles === "ocultar";
  const actor = actorEmail;
  const motivo = v.motivo;

  /**
   * Los pasos, con nombre.
   *
   * Con nombre y no como un array pelado porque la lista es CONDICIONAL
   * —ocultar y borrarComercio agregan pasos— y leer el resultado por
   * índice numérico se rompe callado en cuanto alguien agrega uno en el
   * medio: contarías las boletas en la casilla de los pedidos.
   */
  const pasos: Paso[] = [];

  /**
   * PRIMERO SE TRABA LA FILA DE LA CUENTA. Después todo lo demás.
   *
   * Sin esto hay una ventana chica y un daño grande: si otro moderador
   * borra la misma cuenta entre la vista previa y esta transacción, el
   * INSERT del registro entra igual y el DELETE de abajo no encuentra
   * nada. La transacción commitea, y queda una fila afirmando un borrado
   * que esta persona no hizo.
   *
   * El registro es lo ÚNICO que sobrevive a lo que registra. Una fila de
   * más ahí no es ruido: es un borrado inventado que nadie puede
   * desmentir, porque la cuenta ya no está para comparar.
   *
   * El FOR UPDATE toma el lock por toda la transacción: un borrado
   * concurrente espera a que esta termine, y si ya se había ido, el
   * WHERE EXISTS de abajo hace que el registro tampoco se escriba.
   */
  pasos.push({
    clave: "traba",
    q: sql`SELECT email FROM user_profiles WHERE lower(email) = ${email} FOR UPDATE`,
  });

  /**
   * Y el registro se escribe SOLO si la cuenta sigue ahí.
   *
   * INSERT ... SELECT ... WHERE EXISTS y no VALUES: es la misma guarda
   * que el lock, desde el otro lado. Juntas no dejan ningún camino en el
   * que quede una fila sin su borrado.
   */
  pasos.push({
    clave: "registro",
    q: sql`
      INSERT INTO account_removals (email, removed_by, mode, note, plan)
      SELECT ${inv.email}, ${actor}, ${modo}, ${motivo}, ${JSON.stringify(plan)}::jsonb
      WHERE EXISTS (SELECT 1 FROM user_profiles WHERE lower(email) = ${email})
      RETURNING id
    `,
  });

  if (ocultar) {
    /**
     * Ocultar = censurar, con el mismo mecanismo de siempre.
     *
     * Y alcanza también a los sets y tracks del artista, igual que el
     * ban: si solo se ocultara el perfil, la discografía seguiría
     * saliendo en /sets y /discografia. Esconder a medias es peor que no
     * esconder, porque nadie se da cuenta.
     *
     * Los eventos y las noticias del colectivo NO se tocan, por la misma
     * razón que no los toca el ban: hay gente con boletas compradas para
     * esas fiestas.
     *
     * El `censored_at IS NULL` está para no pisar el motivo de una
     * censura anterior: la primera decisión es la que vale.
     */
    pasos.push({
      clave: "artistas_ocultados",
      q: sql`
        UPDATE artists SET censored_at = now(), censored_by = ${actor}, censor_reason = ${motivo}
        WHERE lower(owner_email) = ${email} AND censored_at IS NULL
        RETURNING slug
      `,
    });
    pasos.push({
      clave: "sets_ocultados",
      q: sql`
        UPDATE dj_sets SET censored_at = now(), censored_by = ${actor}, censor_reason = ${motivo}
        WHERE censored_at IS NULL
          AND artist_slug IN (SELECT slug FROM artists WHERE lower(owner_email) = ${email})
        RETURNING slug
      `,
    });
    pasos.push({
      clave: "tracks_ocultados",
      q: sql`
        UPDATE tracks SET censored_at = now(), censored_by = ${actor}, censor_reason = ${motivo}
        WHERE censored_at IS NULL
          AND artist_slug IN (SELECT slug FROM artists WHERE lower(owner_email) = ${email})
        RETURNING slug
      `,
    });
    pasos.push({
      clave: "colectivos_ocultados",
      q: sql`
        UPDATE collectives SET censored_at = now(), censored_by = ${actor}, censor_reason = ${motivo}
        WHERE lower(owner_email) = ${email} AND censored_at IS NULL
        RETURNING slug
      `,
    });
  }

  /**
   * Las cesiones abiertas de esta cuenta se revocan ANTES de que el FK
   * le vacíe el email.
   *
   * Sin esto queda una cesión pendiente sin nadie a quien aceptarle —el
   * SET NULL le saca el to_email pero la deja abierta— y el colectivo no
   * se puede volver a ceder nunca. No falla: BLOQUEA. Es el mismo modo
   * de falla que encontró el reviewer en el schema de profile_ownership,
   * y el predicado del índice ya lo cubre; esto además deja la fila
   * diciendo la verdad sobre por qué se cerró.
   */
  pasos.push({
    clave: "cesiones_revocadas",
    q: sql`
      UPDATE profile_ownership SET revoked_at = now()
      WHERE (lower(to_email) = ${email} OR lower(from_email) = ${email})
        AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `,
  });

  if (opciones.borrarComercio) {
    /**
     * EL ORDEN ES EL MECANISMO. De adentro hacia afuera:
     *
     *   ticket_attributions -> tickets  (ON DELETE RESTRICT)
     *   tickets             -> orders   (ON DELETE RESTRICT)
     *   tickets             -> order_items (ON DELETE RESTRICT)
     *   order_items         -> orders   (ON DELETE CASCADE)
     *
     * order_items caería solo con el CASCADE de orders; va explícito
     * para poder CONTARLO. Un borrado que no puede decir cuántas filas
     * se llevó no es un borrado auditado.
     */
    pasos.push({
      clave: "atribuciones",
      q: sql`
        DELETE FROM ticket_attributions
        WHERE ticket_id IN (SELECT id FROM tickets WHERE lower(user_email) = ${email})
        RETURNING id
      `,
    });
    pasos.push({
      clave: "boletas",
      q: sql`DELETE FROM tickets WHERE lower(user_email) = ${email} RETURNING id`,
    });
    pasos.push({
      clave: "items_de_pedido",
      q: sql`
        DELETE FROM order_items
        WHERE order_id IN (SELECT id FROM orders WHERE lower(user_email) = ${email})
        RETURNING id
      `,
    });
    pasos.push({
      clave: "pedidos",
      q: sql`DELETE FROM orders WHERE lower(user_email) = ${email} RETURNING id`,
    });
  }

  pasos.push({
    clave: "cuenta",
    q: sql`DELETE FROM user_profiles WHERE lower(email) = ${email} RETURNING email`,
  });

  let resultados: unknown[];
  try {
    resultados = await sql.transaction(pasos.map((p) => p.q));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    /**
     * El RESTRICT pudo saltar igual: entre la vista previa y esta
     * transacción alguien puede haber comprado. La transacción no dejó
     * nada a medias —el registro también se fue— así que lo único que
     * hay que hacer es decirlo.
     */
    if (msg.includes("violates foreign key")) {
      return {
        ok: false,
        status: 409,
        error:
          "Algo apareció entre la vista previa y la confirmación —lo más probable, un pedido o una " +
          "boleta nueva— y la base frenó el borrado. No se borró nada. Volvé a mirar la vista previa.",
      };
    }
    return { ok: false, status: 409, error: `No se pudo eliminar: ${msg}` };
  }

  const filasDe = (clave: string): unknown[] => {
    const i = pasos.findIndex((p) => p.clave === clave);
    const r = i >= 0 ? resultados[i] : null;
    return Array.isArray(r) ? r : [];
  };
  const por = (clave: string): number => filasDe(clave).length;

  if (por("cuenta") === 0) {
    /**
     * Llegar acá significa que alguien la borró primero: el lock la
     * encontró vacía, el registro no se escribió por el WHERE EXISTS, y
     * el DELETE no tenía nada. No quedó rastro de este intento, que es
     * lo correcto — el borrado lo hizo otro y ya tiene su propia fila.
     */
    return { ok: false, status: 409, error: "Alguien la eliminó mientras tanto" };
  }

  /**
   * El id sale del paso POR NOMBRE, no de resultados[0]. Con el lock
   * adelante, el índice 0 ya no es el registro, y leer por posición es
   * cómo se termina guardando la medición en la fila equivocada.
   */
  const registroId = Number((filasDe("registro")[0] as { id?: number } | undefined)?.id ?? 0);

  const medido: Record<string, number> = {
    cesiones_revocadas: por("cesiones_revocadas"),
    artistas_ocultados: por("artistas_ocultados"),
    sets_ocultados: por("sets_ocultados"),
    tracks_ocultados: por("tracks_ocultados"),
    colectivos_ocultados: por("colectivos_ocultados"),
    atribuciones: por("atribuciones"),
    boletas: por("boletas"),
    items_de_pedido: por("items_de_pedido"),
    pedidos: por("pedidos"),
  };

  /**
   * El conteo real se escribe DESPUÉS del commit, porque recién ahí
   * existe. Si este UPDATE falla, la fila queda con measured en NULL —y
   * eso significa exactamente "se borró pero no se alcanzó a contar",
   * que es información honesta y no un hueco. El llamador se entera por
   * registroCompleto.
   */
  let registroCompleto = true;
  try {
    await sql`
      UPDATE account_removals
      SET measured = ${JSON.stringify({
        ...medido,
        destino_perfiles: opciones.destinoPerfiles,
        likes: plan.likes,
        roles: plan.roles,
        monto_cop: plan.monto_cop,
      })}::jsonb
      WHERE id = ${registroId}
    `;
  } catch {
    registroCompleto = false;
  }

  return { ok: true, value: { eliminada: true, registroId, medido, registroCompleto } };
}

/**
 * Una cuenta, resumida, para la lista de la limpieza.
 *
 * `actualizada` sale de updated_at y NO es la fecha de alta: user_profiles
 * no guarda cuándo se creó la fila. Se muestra igual porque ordena algo,
 * pero el nombre no puede prometer lo que el dato no dice.
 */
export type CuentaListada = {
  email: string;
  displayName: string | null;
  authProvider: string | null;
  tieneContrasena: boolean;
  baneada: boolean;
  esModerador: boolean;
  fantasma: boolean;
  actualizada: string | null;
  likes: number;
  pedidos: number;
  boletas: number;
  roles: number;
  perfiles: number;
};

/**
 * Todas las cuentas, con lo que hace falta para elegir cuáles borrar.
 *
 * Una sola consulta con subconsultas, no una por cuenta: la pantalla
 * pide esto entero cada vez que se abre, y N+1 sobre veinte cuentas ya
 * se nota.
 *
 * NO filtra por nada que se parezca a "de prueba". La selección es
 * EXPLÍCITA, cuenta por cuenta: un LIKE '%test%' es exactamente cómo se
 * borra de más, y acá no hay vuelta atrás.
 */
export async function listarCuentas(): Promise<CuentaListada[]> {
  const filas = await sql`
    SELECT
      u.email, u.display_name, u.auth_provider, u.updated_at,
      u.password_hash IS NOT NULL AS tiene_pass,
      u.banned_at IS NOT NULL AS baneada,
      (SELECT COUNT(*)::int FROM artist_likes WHERE lower(user_email) = lower(u.email))
      + (SELECT COUNT(*)::int FROM collective_likes WHERE lower(user_email) = lower(u.email)) AS likes,
      (SELECT COUNT(*)::int FROM orders WHERE lower(user_email) = lower(u.email)) AS pedidos,
      (SELECT COUNT(*)::int FROM tickets WHERE lower(user_email) = lower(u.email)) AS boletas,
      (SELECT COUNT(*)::int FROM user_roles WHERE lower(email) = lower(u.email)) AS roles,
      (SELECT COUNT(*)::int FROM artists WHERE lower(owner_email) = lower(u.email))
      + (SELECT COUNT(*)::int FROM collectives WHERE lower(owner_email) = lower(u.email)) AS perfiles,
      EXISTS (
        SELECT 1 FROM user_roles r
        WHERE lower(r.email) = lower(u.email) AND r.role IN ('SUPER_ADMIN', 'MODERATOR')
      ) AS modera
    FROM user_profiles u
    ORDER BY u.email
  `;
  return filas.map((f) => {
    const likes = Number(f.likes ?? 0);
    const pedidos = Number(f.pedidos ?? 0);
    const boletas = Number(f.boletas ?? 0);
    const roles = Number(f.roles ?? 0);
    return {
      email: f.email as string,
      displayName: (f.display_name as string | null) ?? null,
      authProvider: (f.auth_provider as string | null) ?? null,
      tieneContrasena: f.tiene_pass === true,
      baneada: f.baneada === true,
      /**
       * Un rol cualquiera no alcanza: lo que importa es si MODERA, que
       * es lo único que bloquea la eliminación. Y la whitelist de
       * ADMIN_EMAILS cuenta igual que una fila en user_roles, porque
       * isModerator la mira primero: si acá no se mirara, la lista
       * mostraría como borrable a alguien que el lib después rechaza.
       */
      esModerador: f.modera === true || isAdminEmail(f.email as string),
      /**
       * El MISMO criterio que el traspaso, con la misma función pura.
       * Si esta lista dijera "fantasma" con una regla propia, dos
       * pantallas del admin discreparían sobre la misma cuenta.
       */
      fantasma: esCuentaFantasma({
        tieneContrasena: f.tiene_pass === true,
        proveedorVinculado: f.auth_provider === "google",
        likes,
        pedidos,
        boletas,
        roles,
      }),
      actualizada: f.updated_at ? String(f.updated_at) : null,
      likes,
      pedidos,
      boletas,
      roles,
      perfiles: Number(f.perfiles ?? 0),
    };
  });
}

/** Las últimas eliminaciones, para que la pantalla las pueda mostrar. */
export type Eliminacion = {
  id: number;
  email: string;
  removedBy: string;
  mode: ModoBorrado;
  note: string;
  plan: Record<string, unknown>;
  measured: Record<string, unknown> | null;
  removedAt: string;
};

export async function getEliminaciones(limite = 100): Promise<Eliminacion[]> {
  const filas = await sql`
    SELECT id, email, removed_by, mode, note, plan, measured, removed_at
    FROM account_removals ORDER BY removed_at DESC, id DESC LIMIT ${limite}
  `;
  return filas.map((f) => ({
    id: Number(f.id),
    email: f.email as string,
    removedBy: f.removed_by as string,
    mode: f.mode as ModoBorrado,
    note: f.note as string,
    plan: (f.plan as Record<string, unknown>) ?? {},
    measured: (f.measured as Record<string, unknown> | null) ?? null,
    removedAt: String(f.removed_at),
  }));
}
