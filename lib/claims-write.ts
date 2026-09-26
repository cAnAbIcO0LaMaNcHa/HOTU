/**
 * RECLAMAR UN PERFIL (§8 pieza 2).
 *
 * ============================================================
 * QUÉ PROBLEMA RESUELVE
 * ============================================================
 *
 * Los 12 artistas y 6 colectivos de producción tienen cuenta dueña
 * `<slug>@perfil.hotu.local`, creada para que el FK tuviera a quién
 * apuntar. Esas cuentas nacieron SIN CONTRASEÑA, así que existen, son
 * dueñas, y nadie puede entrar con ellas. Los perfiles no quedaron
 * inalcanzables: quedaron RESERVADOS.
 *
 * La pieza 1 fue el formulario del moderador para entregar un perfil. Esta
 * es la otra mitad: que la persona pueda pedirlo ella.
 *
 * ============================================================
 * EL MAIL NO ES LO QUE HACE SEGURO AL RECLAMO
 * ============================================================
 *
 * No se puede verificar mandando un código "a la dirección registrada":
 * esa dirección no existe, y el patrón `<slug>@dominio` es DEDUCIBLE desde
 * la URL del perfil. Conocer el email no prueba nada.
 *
 * La prueba de identidad la pone el MODERADOR, mirando lo que el
 * reclamante escribió. El mail solo sirve para que el trámite no sea
 * silencioso, y por eso cada aviso tiene además su equivalente adentro del
 * sitio: hoy no hay transporte de correo y el reclamo funciona igual.
 *
 * ============================================================
 * SE RECLAMA LO DESAMPARADO *Y* LO QUE TIENE DUEÑO FANTASMA
 * ============================================================
 *
 * Esto es lo central y es fácil de errar. Si la regla fuera "solo
 * perfiles sin dueño", los 18 que más necesitan reclamarse quedarían
 * afuera: TIENEN dueño, y es una cuenta que no puede entrar.
 *
 * Así que reclamable = sin dueño, O con un dueño que es una cuenta
 * fantasma según esCuentaFantasma() — la misma función pura que usa el
 * traspaso. Un perfil con dueño de verdad NO se reclama: eso es una
 * disputa entre dos personas, y no la resuelve un formulario.
 */

import { neon } from "@neondatabase/serverless";
import { isModerator } from "./roles-check";
import { getAdminEmails } from "./admin-emails";
import { limpiarTexto, recortar } from "./texto";
import { actividadDeCuenta, esCuentaFantasma } from "./accounts";
import { enviar, enviarA, type PerfilRef } from "./mail";
import type { WriteResult } from "./collectives-write";

const sql = neon(process.env.DATABASE_URL!);

export type TipoPerfil = "artist" | "collective";

export function esTipoPerfil(v: unknown): v is TipoPerfil {
  return v === "artist" || v === "collective";
}

/** Lo mínimo que tiene que decir un reclamo. Es lo único que el moderador
 *  va a tener para decidir, así que un "es mío" de siete letras no sirve. */
const MIN_NOTA = 30;

/**
 * CUÁNTOS RECLAMOS ABIERTOS PUEDE TENER UNA CUENTA A LA VEZ.
 *
 * Tres, y el número está elegido contra un caso de uso real y un abuso
 * concreto.
 *
 * Lo legítimo: alguien que llega y encuentra su perfil de DJ y el
 * colectivo que armó son dos. Con un segundo colectivo, tres. Más de tres
 * perfiles ajenos reclamados al mismo tiempo por una sola cuenta no es un
 * caso que se nos ocurra, y si aparece, lo resuelve un moderador aprobando
 * los primeros.
 *
 * El abuso: registrarse con credenciales es gratis y no está verificado
 * —HOTU no tiene transporte de mail para verificarlo—, así que una cuenta
 * podría abrir reclamos en serie para que muchos perfiles se vean
 * disputados. Con el tope, molestar a N perfiles cuesta N/3 registros, y
 * cada uno queda con su rastro y su cuenta baneable.
 *
 * Esto NO puede ser un índice ni un CHECK: cuenta filas de OTRAS filas de
 * la misma tabla, y eso ninguna de las dos cosas lo puede mirar. Es la
 * misma familia que la casa-en-venue: guarda del write path, y por eso
 * está escrito acá con su razón, para que no se "simplifique" a un
 * constraint que no existe.
 */
const MAX_RECLAMOS_ABIERTOS = 3;

type FilaPerfil = {
  slug: string;
  nombre: string;
  ownerEmail: string | null;
  contactEmail: string | null;
};

async function leerPerfil(tipo: TipoPerfil, slug: string): Promise<FilaPerfil | null> {
  // El nombre de tabla sale de un literal según el tipo ya validado:
  // nada de esto viene del request como texto libre.
  const filas =
    tipo === "artist"
      ? await sql`SELECT slug, name, owner_email, contact_email FROM artists WHERE slug = ${slug}`
      : await sql`SELECT slug, name, owner_email, NULL AS contact_email FROM collectives WHERE slug = ${slug}`;
  const f = filas[0];
  if (!f) return null;
  return {
    slug: f.slug as string,
    nombre: f.name as string,
    ownerEmail: (f.owner_email as string | null) ?? null,
    contactEmail: (f.contact_email as string | null) ?? null,
  };
}

const ref = (tipo: TipoPerfil, p: FilaPerfil): PerfilRef => ({
  tipo,
  slug: p.slug,
  nombre: p.nombre,
});

/**
 * ¿Este perfil se puede reclamar, y por qué sí o por qué no?
 *
 * Devuelve el motivo en vez de un booleano porque la pantalla lo muestra:
 * "no se puede reclamar" sin decir por qué manda a la gente a escribirle
 * a alguien para preguntar.
 */
export type Reclamabilidad =
  | { puede: true; razon: "sin_dueno" | "dueno_fantasma" }
  | { puede: false; razon: "no_existe" | "tiene_dueno" };

export async function reclamabilidad(
  tipo: TipoPerfil,
  slug: string
): Promise<Reclamabilidad> {
  const p = await leerPerfil(tipo, limpiarTexto(slug));
  if (!p) return { puede: false, razon: "no_existe" };
  if (!p.ownerEmail) return { puede: true, razon: "sin_dueno" };

  const act = await actividadDeCuenta(p.ownerEmail);
  // Sin fila de cuenta el owner_email apunta a la nada: reclamable.
  if (!act) return { puede: true, razon: "sin_dueno" };
  return esCuentaFantasma(act)
    ? { puede: true, razon: "dueno_fantasma" }
    : { puede: false, razon: "tiene_dueno" };
}

/* ===================================================================
 * RECLAMAR
 * =================================================================== */

export async function reclamarPerfil(
  tipoCrudo: unknown,
  slugCrudo: unknown,
  notaCruda: unknown,
  actorEmail: string | null | undefined
): Promise<WriteResult<{ reclamoId: number; perfil: string }>> {
  if (!actorEmail) return { ok: false, status: 403, error: "Not signed in" };
  if (!esTipoPerfil(tipoCrudo)) {
    return { ok: false, status: 400, error: "tipo tiene que ser 'artist' o 'collective'" };
  }
  const tipo = tipoCrudo;
  const slug = limpiarTexto(slugCrudo);
  if (!slug) return { ok: false, status: 400, error: "Falta el perfil" };

  const nota = limpiarTexto(notaCruda);
  if (nota.length < MIN_NOTA) {
    return {
      ok: false,
      status: 400,
      error:
        `Contá quién sos y por qué el perfil es tuyo: al menos ${MIN_NOTA} caracteres. ` +
        "Es lo único que va a tener un moderador para decidir.",
    };
  }

  const email = actorEmail.toLowerCase();

  /**
   * UNA CUENTA FANTASMA NO PUEDE RECLAMAR.
   *
   * Son las cuentas `<slug>@perfil.hotu.local` que creamos nosotros para
   * que el FK tuviera a quién apuntar. No puede entrar nadie con ellas, y
   * si alguna reclamara un perfil el resultado sería entregarlo a una
   * cuenta que tampoco sirve para entrar: el problema en círculo.
   *
   * Mismo criterio y MISMA FUNCIÓN PURA que el traspaso, para que las dos
   * pantallas no discrepen sobre la misma cuenta.
   */
  const actividad = await actividadDeCuenta(email);
  if (!actividad) return { ok: false, status: 403, error: "Tu cuenta no existe" };
  if (esCuentaFantasma(actividad)) {
    return {
      ok: false,
      status: 403,
      error:
        "Esta cuenta no puede reclamar: es una de las que creamos para que los perfiles " +
        "sin dueño tuvieran una, y no se puede entrar con ella. Registrate con tu propio correo.",
    };
  }

  const [baneada] = await sql`
    SELECT 1 FROM user_profiles WHERE lower(email) = ${email} AND banned_at IS NOT NULL
  `;
  if (baneada) return { ok: false, status: 403, error: "Esta cuenta está cerrada" };

  /**
   * El tope por cuenta. Ver MAX_RECLAMOS_ABIERTOS arriba: es una guarda de
   * write path porque cuenta otras filas de la misma tabla, y eso ni un
   * CHECK ni un índice lo pueden mirar.
   */
  const [abiertos] = await sql`
    SELECT COUNT(*)::int AS n FROM profile_ownership
    WHERE kind = 'reclamo' AND lower(to_email) = ${email}
      AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
  `;
  if (Number(abiertos?.n ?? 0) >= MAX_RECLAMOS_ABIERTOS) {
    return {
      ok: false,
      status: 409,
      error:
        `Ya tenés ${MAX_RECLAMOS_ABIERTOS} reclamos esperando respuesta, que es el máximo. ` +
        "Esperá a que se resuelva alguno antes de abrir otro.",
    };
  }

  const p = await leerPerfil(tipo, slug);
  if (!p) return { ok: false, status: 404, error: "No encontré ese perfil" };

  const r = await reclamabilidad(tipo, slug);
  if (!r.puede) {
    return r.razon === "no_existe"
      ? { ok: false, status: 404, error: "No encontré ese perfil" }
      : {
          ok: false,
          status: 409,
          error:
            "Ese perfil ya tiene dueño. Si creés que es un error, escribinos: una disputa " +
            "entre dos personas no la resuelve un formulario.",
        };
  }

  // Ya es dueño: no hay nada que reclamar.
  if (p.ownerEmail && p.ownerEmail.toLowerCase() === email) {
    return { ok: false, status: 409, error: "Ese perfil ya es tuyo" };
  }

  const columna = tipo === "artist" ? "artist_slug" : "collective_slug";
  let reclamoId = 0;
  try {
    const [fila] = await sql(
      `INSERT INTO profile_ownership (${columna}, kind, from_email, to_email, note)
       VALUES ($1, 'reclamo', $2, $3, $4) RETURNING id`,
      [p.slug, p.ownerEmail, email, recortar(nota, 4000)]
    );
    reclamoId = Number(fila.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // El índice único parcial: un reclamo abierto por persona y perfil.
    if (msg.includes("duplicate key") || msg.includes("unique constraint")) {
      return {
        ok: false,
        status: 409,
        error: "Ya tenés un reclamo abierto sobre este perfil. Esperá la respuesta.",
      };
    }
    return { ok: false, status: 409, error: `No se pudo registrar el reclamo: ${msg}` };
  }

  /**
   * Los avisos van DESPUÉS y fuera de cualquier transacción.
   *
   * enviar() no tira nunca, pero igual: si el reclamo se registró, se
   * registró, y que un aviso falle no puede deshacerlo. Darle a un aviso
   * el poder de voltear la acción que lo disparó es al revés.
   */
  const perfil = ref(tipo, p);
  await enviar({ tipo: "reclamo_recibido", para: email, perfil });
  await enviarA(await emailsDeModeradores(), (para) => ({
    tipo: "reclamo_en_cola",
    para,
    perfil,
    reclamante: email,
  }));
  if (p.contactEmail) {
    await enviar({ tipo: "reclamo_avisa_perfil", para: p.contactEmail, perfil });
  }

  return { ok: true, value: { reclamoId, perfil: p.slug } };
}

/** Quién tiene que enterarse de que hay algo esperando una decisión. */
async function emailsDeModeradores(): Promise<string[]> {
  const filas = await sql`
    SELECT DISTINCT email FROM user_roles WHERE role IN ('SUPER_ADMIN', 'MODERATOR')
  `;
  return [...filas.map((f) => f.email as string), ...getAdminEmails()];
}

/* ===================================================================
 * RESPONDER
 * =================================================================== */

export async function responderReclamo(
  idCrudo: unknown,
  accion: unknown,
  motivoCrudo: unknown,
  moderadorEmail: string | null | undefined
): Promise<WriteResult<{ perfil: string; aprobado: boolean }>> {
  if (!moderadorEmail || !(await isModerator(moderadorEmail))) {
    return { ok: false, status: 403, error: "Solo un moderador responde un reclamo" };
  }
  if (accion !== "aprobar" && accion !== "rechazar") {
    return { ok: false, status: 400, error: "accion tiene que ser 'aprobar' o 'rechazar'" };
  }
  const id = typeof idCrudo === "number" ? idCrudo : Number(limpiarTexto(idCrudo));
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, status: 400, error: "Falta el reclamo" };
  }

  /**
   * Un rechazo SIN motivo no se puede guardar: lo exige la base y lo
   * exige acá. Es lo único que la persona va a recibir.
   *
   * Al aprobar el motivo es opcional: la respuesta es el perfil en su
   * panel, que dice más que cualquier texto.
   */
  const motivo = limpiarTexto(motivoCrudo);
  if (accion === "rechazar" && motivo.length < 10) {
    return {
      ok: false,
      status: 400,
      error: "Un rechazo necesita motivo: al menos 10 caracteres. Es lo único que recibe.",
    };
  }

  const [rec] = await sql`
    SELECT id, collective_slug, artist_slug, to_email, note
    FROM profile_ownership
    WHERE id = ${id} AND kind = 'reclamo'
      AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
  `;
  if (!rec) {
    return { ok: false, status: 409, error: "Ese reclamo no existe o ya fue respondido" };
  }

  const tipo: TipoPerfil = rec.artist_slug ? "artist" : "collective";
  const slug = (rec.artist_slug ?? rec.collective_slug) as string;
  const reclamante = (rec.to_email as string | null) ?? null;
  if (!reclamante) {
    return {
      ok: false,
      status: 409,
      error:
        "El reclamante borró su cuenta, así que no hay a quién entregarle el perfil. " +
        "Cerralo rechazándolo.",
    };
  }

  const p = await leerPerfil(tipo, slug);
  if (!p) return { ok: false, status: 404, error: "El perfil ya no existe" };
  const perfil = ref(tipo, p);

  if (accion === "rechazar") {
    await sql`
      UPDATE profile_ownership
      SET declined_at = now(), decision_note = ${recortar(motivo, 2000)}, decided_by = ${moderadorEmail}
      WHERE id = ${id} AND declined_at IS NULL AND accepted_at IS NULL AND revoked_at IS NULL
    `;
    await enviar({ tipo: "reclamo_rechazado", para: reclamante, perfil, motivo });
    return { ok: true, value: { perfil: slug, aprobado: false } };
  }

  /**
   * Aprobar son TRES escrituras y van juntas en una transacción: el
   * perfil cambia de dueño, el reclamo se marca aceptado, y los OTROS
   * reclamos abiertos sobre el mismo perfil se cierran.
   *
   * Los otros se REVOCAN, no se rechazan: no perdieron por lo que
   * escribieron, el perfil se fue a otra persona. La distinción importa
   * porque un 'rechazado' es un juicio sobre alguien.
   *
   * Si esto fueran tres requests sueltos —y cada sql del driver HTTP es
   * su propio request— un fallo en el medio dejaría el perfil entregado
   * con el reclamo abierto, o el reclamo aceptado sin que el perfil
   * cambiara de manos.
   */
  const tabla = tipo === "artist" ? "artists" : "collectives";
  const columna = tipo === "artist" ? "artist_slug" : "collective_slug";
  await sql.transaction([
    sql(`UPDATE ${tabla} SET owner_email = $1 WHERE slug = $2`, [reclamante, slug]),
    sql(
      `UPDATE profile_ownership SET accepted_at = now(), decision_note = $1, decided_by = $2
       WHERE id = $3 AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`,
      [motivo === "" ? null : recortar(motivo, 2000), moderadorEmail, id]
    ),
    sql(
      `UPDATE profile_ownership SET revoked_at = now(), decided_by = $1,
              decision_note = 'El perfil se entregó a otro reclamante.'
       WHERE kind = 'reclamo' AND ${columna} = $2 AND id <> $3
         AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`,
      [moderadorEmail, slug, id]
    ),
  ]);

  await enviar({ tipo: "reclamo_aprobado", para: reclamante, perfil });
  return { ok: true, value: { perfil: slug, aprobado: true } };
}

/* ===================================================================
 * LECTURAS
 * =================================================================== */

export type ReclamoPendiente = {
  id: number;
  tipo: TipoPerfil;
  slug: string;
  nombre: string;
  reclamante: string;
  nota: string;
  /**
   * CÓMO SE REGISTRÓ el reclamante. No reemplaza el juicio del
   * moderador: es una señal. 'google' significa que Google verificó ese
   * correo; 'credentials' significa que nadie lo verificó todavía,
   * porque HOTU no tiene transporte de mail para hacerlo.
   */
  proveedor: string | null;
  correoVerificado: boolean;
  ofrecidoEn: string;
  dias: number;
};

export async function getReclamosPendientes(): Promise<ReclamoPendiente[]> {
  const filas = await sql`
    SELECT o.id, o.collective_slug, o.artist_slug, o.to_email, o.note, o.offered_at,
           EXTRACT(DAY FROM (now() - o.offered_at))::int AS dias,
           u.auth_provider,
           COALESCE(a.name, c.name) AS nombre
    FROM profile_ownership o
    LEFT JOIN user_profiles u ON lower(u.email) = lower(o.to_email)
    LEFT JOIN artists a ON a.slug = o.artist_slug
    LEFT JOIN collectives c ON c.slug = o.collective_slug
    WHERE o.kind = 'reclamo'
      AND o.accepted_at IS NULL AND o.declined_at IS NULL AND o.revoked_at IS NULL
    ORDER BY o.offered_at ASC
  `;
  return filas.map((f) => ({
    id: Number(f.id),
    tipo: (f.artist_slug ? "artist" : "collective") as TipoPerfil,
    slug: (f.artist_slug ?? f.collective_slug) as string,
    nombre: (f.nombre as string | null) ?? String(f.artist_slug ?? f.collective_slug),
    reclamante: (f.to_email as string | null) ?? "(cuenta borrada)",
    nota: (f.note as string | null) ?? "",
    proveedor: (f.auth_provider as string | null) ?? null,
    correoVerificado: f.auth_provider === "google",
    ofrecidoEn: String(f.offered_at),
    dias: Number(f.dias ?? 0),
  }));
}

export type MiReclamo = {
  id: number;
  tipo: TipoPerfil;
  slug: string;
  nombre: string;
  estado: "esperando" | "aprobado" | "rechazado" | "cerrado";
  motivo: string | null;
  ofrecidoEn: string;
};

/** La bandeja del reclamante: el equivalente en pantalla de sus mails. */
export async function getMisReclamos(email: string): Promise<MiReclamo[]> {
  const filas = await sql`
    SELECT o.id, o.collective_slug, o.artist_slug, o.decision_note, o.offered_at,
           o.accepted_at, o.declined_at, o.revoked_at,
           COALESCE(a.name, c.name) AS nombre
    FROM profile_ownership o
    LEFT JOIN artists a ON a.slug = o.artist_slug
    LEFT JOIN collectives c ON c.slug = o.collective_slug
    WHERE o.kind = 'reclamo' AND lower(o.to_email) = lower(${email})
    ORDER BY o.offered_at DESC
  `;
  return filas.map((f) => ({
    id: Number(f.id),
    tipo: (f.artist_slug ? "artist" : "collective") as TipoPerfil,
    slug: (f.artist_slug ?? f.collective_slug) as string,
    nombre: (f.nombre as string | null) ?? String(f.artist_slug ?? f.collective_slug),
    estado: f.accepted_at
      ? "aprobado"
      : f.declined_at
        ? "rechazado"
        : f.revoked_at
          ? "cerrado"
          : "esperando",
    motivo: (f.decision_note as string | null) ?? null,
    ofrecidoEn: String(f.offered_at),
  }));
}

/**
 * ¿ESTA persona ya tiene un reclamo abierto sobre ESTE perfil?
 *
 * Es lo que decide si el perfil le muestra el formulario o "tu reclamo
 * está esperando". Sin esto, alguien que ya reclamó vuelve, ve el botón
 * otra vez, escribe todo de nuevo y recibe un 409 del índice único
 * después de haber trabajado. El error correcto llega tarde.
 */
export async function tieneReclamoAbierto(
  email: string,
  tipo: TipoPerfil,
  slug: string
): Promise<boolean> {
  const columna = tipo === "artist" ? "artist_slug" : "collective_slug";
  const [f] = await sql(
    `SELECT 1 AS x FROM profile_ownership
     WHERE kind = 'reclamo' AND ${columna} = $1 AND lower(to_email) = lower($2)
       AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`,
    [slug, email]
  );
  return Boolean(f);
}

/** ¿Hay un reclamo abierto sobre este perfil? Para la franja del perfil. */
export async function hayReclamoAbierto(tipo: TipoPerfil, slug: string): Promise<number> {
  const columna = tipo === "artist" ? "artist_slug" : "collective_slug";
  const [f] = await sql(
    `SELECT COUNT(*)::int AS n FROM profile_ownership
     WHERE kind = 'reclamo' AND ${columna} = $1
       AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`,
    [slug]
  );
  return Number(f?.n ?? 0);
}
