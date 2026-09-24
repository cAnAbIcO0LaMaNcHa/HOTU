/**
 * Accounts: password hashing and the user_profiles upsert that has to run
 * on every sign-in.
 *
 * user_profiles is THE account table — one account with activatable roles,
 * credentials stored here and nowhere else. artists has no password_hash.
 *
 * Node-only: this uses node:crypto's scrypt, so anything importing it must
 * run on the Node runtime, never Edge. Never import it from a client
 * component either — same rule as lib/db.ts.
 */

import { neon } from "@neondatabase/serverless";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const sql = neon(process.env.DATABASE_URL!);

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Emails are the primary key of user_profiles, so they must be normalised
 *  identically everywhere or the same person gets two rows. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Stored as "s1:<salt base64>:<key base64>". The version prefix is there so
 * a future change of algorithm or cost can be rolled out by writing "s2:"
 * hashes while still verifying every "s1:" hash already in the table.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH);
  return `s1:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "s1") return false;

  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  // timingSafeEqual throws on a length mismatch, so check before comparing.
  if (expected.length !== KEY_LENGTH) return false;

  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH);
  return timingSafeEqual(key, expected);
}

export type AccountUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

/**
 * Creates the user_profiles row on first sign-in, or refreshes it on later
 * ones. This is not optional bookkeeping: artist_likes.user_email is a
 * foreign key to user_profiles(email), so a session without a row here
 * means the user authenticates fine and then blows up on their first like.
 *
 * On conflict:
 *   - auth_provider is left alone. It records how the account was created,
 *     so a Google sign-in must not rewrite an account that already exists.
 *   - display_name keeps whatever is already stored — the user may have
 *     edited it, and the provider's version should not clobber that.
 *   - avatar_url prefers the fresh value, falling back to the stored one,
 *     so a Google profile picture stays current but is never wiped.
 */
export async function upsertAccount(input: {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  provider: "google" | "credentials";
}): Promise<void> {
  const email = normalizeEmail(input.email);
  await sql`
    INSERT INTO user_profiles (email, display_name, avatar_url, auth_provider, updated_at)
    VALUES (
      ${email},
      ${input.displayName ?? null},
      ${input.avatarUrl ?? null},
      ${input.provider},
      now()
    )
    ON CONFLICT (email) DO UPDATE SET
      display_name = COALESCE(user_profiles.display_name, EXCLUDED.display_name),
      avatar_url   = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
      updated_at   = now()
  `;
}

/** Mínimo de la contraseña. Largo y nada más: exigir símbolos empuja a
 *  la gente a "Password1!" y no compra nada. */
const MIN_PASSWORD = 10;

/** Edad mínima, que es la única razón por la que se guarda la fecha. */
const MIN_AGE = 18;

export type CreateAccountInput = {
  email: unknown;
  password: unknown;
  displayName: unknown;
  birthDate: unknown;
  consent: unknown;
};

export type CreateAccountResult =
  | { ok: true }
  | { ok: false; status: 400; error: string };

/** ¿Cumplió MIN_AGE años a día de hoy? Compara por fecha, no por días,
 *  para no equivocarse por un año bisiesto o por la hora. */
function esMayor(birthDate: string): boolean {
  const n = new Date(birthDate + "T00:00:00Z");
  if (Number.isNaN(n.getTime())) return false;
  const hoy = new Date();
  const limite = new Date(
    Date.UTC(hoy.getUTCFullYear() - MIN_AGE, hoy.getUTCMonth(), hoy.getUTCDate())
  );
  return n.getTime() <= limite.getTime();
}

/**
 * Crea una cuenta con email y contraseña.
 *
 * ============================================================
 * LA RESPUESTA ES LA MISMA EXISTA O NO LA CUENTA
 * ============================================================
 *
 * Tres casos, una sola respuesta:
 *
 *   el email no existe                 -> se crea
 *   existe con auth_provider 'google'  -> NO SE TOCA NADA
 *   existe con 'credentials'           -> NO SE TOCA NADA
 *
 * El segundo es el que importa y no es un caso borde: si el formulario
 * dejara ponerle contraseña a un email que ya es cuenta de Google,
 * cualquiera que sepa tu correo se queda con tu cuenta. Por eso el
 * INSERT lleva ON CONFLICT DO NOTHING y no un DO UPDATE: contra una fila
 * que ya existe, esta función es incapaz de escribir, no solo se
 * abstiene de hacerlo.
 *
 * Y el scrypt SE PAGA SIEMPRE, incluso cuando el hash se va a tirar.
 * Sin eso el tiempo de respuesta delata cuál de los tres casos fue, que
 * es exactamente la enumeración que la respuesta única evita. Es la
 * misma defensa que verifyCredentials ya hace con su DUMMY_HASH, y se
 * hace igual acá a propósito: una defensa consistente con la que ya
 * existe vale más que una nueva.
 *
 * Los errores de VALIDACIÓN sí son específicos —formato de email,
 * contraseña corta, menor de edad—, porque no dicen nada sobre si la
 * cuenta existe. Lo único que se calla es la existencia.
 *
 * Quien llame a esto NO puede iniciar sesión sola cuando devuelve ok.
 * Hacerlo solo cuando la cuenta es nueva sería la filtración misma.
 */
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
  const password = typeof input.password === "string" ? input.password : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const birthDate = typeof input.birthDate === "string" ? input.birthDate.trim() : "";

  // Deliberadamente laxo: cualquier cosa con arroba y un punto después.
  // Validar emails con precisión rechaza direcciones válidas, y acá el
  // que se equivoca se queda sin poder entrar, que ya es el castigo.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, status: 400, error: "Ese correo no se ve válido" };
  }
  if (password.length < MIN_PASSWORD) {
    return {
      ok: false,
      status: 400,
      error: `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres`,
    };
  }
  if (displayName.length < 2 || displayName.length > 60) {
    return { ok: false, status: 400, error: "Poné un nombre de entre 2 y 60 caracteres" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { ok: false, status: 400, error: "Poné tu fecha de nacimiento" };
  }
  if (!esMayor(birthDate)) {
    return {
      ok: false,
      status: 400,
      error: `Tenés que tener al menos ${MIN_AGE} años para abrir una cuenta`,
    };
  }
  if (input.consent !== true) {
    return {
      ok: false,
      status: 400,
      error: "Necesitamos tu autorización para tratar tus datos personales",
    };
  }

  // El scrypt va ANTES de mirar si la cuenta existe, así los tres caminos
  // cuestan lo mismo. Si se hiciera después del SELECT, el caso "ya
  // existe" saldría más rápido y eso solo ya enumera.
  const passwordHash = await hashPassword(password);

  // ON CONFLICT DO NOTHING: contra una fila que ya existe, esto no puede
  // escribir. No hay forma de que un error de más arriba termine pisando
  // la contraseña de una cuenta ajena.
  await sql`
    INSERT INTO user_profiles
      (email, display_name, birth_date, password_hash, auth_provider, consent_at, updated_at)
    VALUES
      (${email}, ${displayName}, ${birthDate}, ${passwordHash}, 'credentials', now(), now())
    ON CONFLICT (email) DO NOTHING
  `;

  // Sin RETURNING y sin mirar el resultado: quien llama no tiene que
  // poder distinguir los casos ni por accidente.
  return { ok: true };
}

/**
 * A dummy hash with the real format and cost. When the email does not
 * exist we still run one scrypt against it, so "no such account" and
 * "wrong password" take about the same time and the response cannot be
 * used to enumerate which emails are registered.
 */
const DUMMY_HASH = `s1:${Buffer.alloc(SALT_LENGTH).toString("base64")}:${Buffer.alloc(
  KEY_LENGTH
).toString("base64")}`;

/** Returns the user for a valid email + password pair, or null. */
export async function verifyCredentials(
  email: string,
  password: string
): Promise<AccountUser | null> {
  const normalized = normalizeEmail(email);
  const rows = await sql`
    SELECT email, display_name, avatar_url, password_hash
    FROM user_profiles
    WHERE email = ${normalized}
  `;

  const row = rows[0];
  const hash = row?.password_hash ?? DUMMY_HASH;
  const ok = await verifyPassword(password, hash);

  // Accounts created through Google have no password_hash, so they can only
  // ever sign in through Google — the dummy comparison above never matches.
  if (!ok || !row?.password_hash) return null;

  return {
    id: row.email,
    email: row.email,
    name: row.display_name ?? null,
    image: row.avatar_url ?? null,
  };
}

/**
 * ¿Esta cuenta está baneada? (tanda 5 §4)
 *
 * Vive acá y no en lib/moderation-write.ts porque la llama el callback
 * signIn de auth.ts, que es el ÚNICO punto por el que pasan los dos
 * proveedores. Importar el módulo de escritura desde la configuración de
 * auth arrastraría isModerator y la cadena de roles a un archivo que se
 * carga en cada request.
 *
 * lower() de los dos lados: user_profiles.email es la PK y se guarda
 * normalizado, pero un proveedor puede mandar el mismo mail con otra
 * capitalización, y un ban que se esquiva escribiendo una mayúscula no
 * es un ban.
 */
export async function cuentaBaneada(email: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM user_profiles
    WHERE lower(email) = lower(${email}) AND banned_at IS NOT NULL
  `;
  return rows.length > 0;
}

/* ===================================================================
 * ¿ES UNA CUENTA FANTASMA?
 *
 * Una cuenta fantasma es una que EXISTE pero que nadie usa ni puede
 * usar: las que el paso 1 de la tanda 5 creó para que los perfiles sin
 * dueño tuvieran una. Saberlo importa porque decide cuánto se lleva un
 * traspaso de moderación: de un fantasma, todo; de una persona real,
 * solo lo que se nombró.
 *
 * ============================================================
 * "SIN CONTRASEÑA" NO ALCANZA, Y CASI FUE UN BUG GRAVE
 * ============================================================
 *
 * Las cuentas de Google tienen password_hash en NULL: entran por OAuth y
 * nunca hubo una contraseña que guardar. Medido en dev:
 *
 *     fedesubu@gmail.com | provider=google | sin_pass=true | 3 pedidos
 *
 * Con "sin contraseña" a secas, la cuenta del dueño del proyecto —con
 * pedidos y todo— quedaba clasificada como fantasma, y un traspaso desde
 * ella se habría llevado absolutamente todo lo que administra.
 *
 * Así que hacen falta LAS DOS cosas: sin contraseña Y sin proveedor
 * vinculado. Juntas significan "no puede autenticarse por ninguna vía":
 * verifyCredentials rechaza un hash NULL, y un alta por Google habría
 * escrito auth_provider='google' — y el ON CONFLICT de upsertAccount NO
 * sobrescribe auth_provider, así que tampoco se ensucia después.
 *
 * ============================================================
 * ES UNA CAPACIDAD, NO UNA HISTORIA. Y HAY QUE CUIDARLA.
 * ============================================================
 *
 * Esto mide "no puede entrar", no "nunca entró". Hoy coinciden porque no
 * hay ninguna otra forma de que una cuenta pierda su contraseña.
 *
 * DEJARÍAN DE COINCIDIR si el flujo de recuperar contraseña —pendiente en
 * PROGRESO.md— alguna vez pusiera password_hash en NULL, aunque fuera un
 * instante: una cuenta real y activa parecería fantasma, y un traspaso se
 * llevaría todo lo suyo. Ese flujo tiene que escribir un hash nuevo o
 * usar una tabla de tokens aparte. Queda anotado en AGENTS.md.
 *
 * La actividad (likes, pedidos, boletas, roles) se mira además de la
 * capacidad: si alguien dejó rastro, no es un fantasma aunque hoy no
 * pueda entrar. Es la guarda que hace que este criterio falle del lado
 * seguro — de más, nunca de menos.
 * =================================================================== */

/** Los hechos que deciden si una cuenta es un fantasma. */
export type ActividadCuenta = {
  /** Tiene password_hash: puede entrar por credenciales. */
  tieneContrasena: boolean;
  /** Tiene un proveedor externo vinculado (Google): puede entrar por ahí. */
  proveedorVinculado: boolean;
  likes: number;
  pedidos: number;
  boletas: number;
  roles: number;
};

/**
 * PURA a propósito: la usan la vista previa y la escritura, y tienen que
 * dar exactamente lo mismo. Duplicar el criterio en dos lugares es cómo
 * una vista previa termina prometiendo algo distinto de lo que pasa.
 */
export function esCuentaFantasma(a: ActividadCuenta): boolean {
  if (a.tieneContrasena) return false;
  if (a.proveedorVinculado) return false;
  return a.likes === 0 && a.pedidos === 0 && a.boletas === 0 && a.roles === 0;
}

/** Lee de la base los hechos que necesita esCuentaFantasma. */
export async function actividadDeCuenta(email: string): Promise<ActividadCuenta | null> {
  const [f] = await sql`
    SELECT
      u.password_hash IS NOT NULL AS tiene_contrasena,
      u.auth_provider = 'google' AS proveedor_vinculado,
      (SELECT COUNT(*)::int FROM artist_likes WHERE lower(user_email) = lower(u.email))
      + (SELECT COUNT(*)::int FROM collective_likes WHERE lower(user_email) = lower(u.email)) AS likes,
      (SELECT COUNT(*)::int FROM orders WHERE lower(user_email) = lower(u.email)) AS pedidos,
      (SELECT COUNT(*)::int FROM tickets WHERE lower(user_email) = lower(u.email)) AS boletas,
      (SELECT COUNT(*)::int FROM user_roles WHERE lower(email) = lower(u.email)) AS roles
    FROM user_profiles u
    WHERE lower(u.email) = lower(${email})
  `;
  if (!f) return null;
  return {
    tieneContrasena: f.tiene_contrasena === true,
    proveedorVinculado: f.proveedor_vinculado === true,
    likes: Number(f.likes ?? 0),
    pedidos: Number(f.pedidos ?? 0),
    boletas: Number(f.boletas ?? 0),
    roles: Number(f.roles ?? 0),
  };
}
