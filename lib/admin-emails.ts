/**
 * The ADMIN_EMAILS whitelist, split out of lib/admin.ts so it can be read
 * from the Edge runtime.
 *
 * lib/admin.ts imports `auth` from @/auth, and @/auth now pulls in the
 * Credentials provider, which needs node:crypto and therefore cannot be
 * bundled for Edge. middleware.ts runs on Edge and only ever needed these
 * two pure functions, so they live here with no imports at all.
 * lib/admin.ts re-exports them, so every existing call site is unchanged.
 */

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
