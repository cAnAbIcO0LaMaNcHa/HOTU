import { auth } from "@/auth";

/**
 * Admin access is controlled by the ADMIN_EMAILS environment variable
 * (comma-separated list). This keeps the list editable from Vercel
 * without touching code, and keeps it out of the public repo.
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

/** Returns the session only if the signed-in user is an admin. */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return null;
  }
  return session;
}
