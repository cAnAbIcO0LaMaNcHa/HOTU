import { auth } from "@/auth";
import { isAdminEmail } from "./admin-emails";

/**
 * Admin access is controlled by the ADMIN_EMAILS environment variable
 * (comma-separated list). This keeps the list editable from Vercel
 * without touching code, and keeps it out of the public repo.
 *
 * The two pure helpers now live in lib/admin-emails.ts so the Edge
 * middleware can reach them without pulling in @/auth, and are re-exported
 * here so every existing import keeps working unchanged.
 */
export { getAdminEmails, isAdminEmail } from "./admin-emails";

/** Returns the session only if the signed-in user is an admin. */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return null;
  }
  return session;
}
