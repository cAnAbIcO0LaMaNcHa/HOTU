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
