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
