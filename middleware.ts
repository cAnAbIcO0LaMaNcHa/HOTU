import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { isSuperAdmin } from "@/lib/roles-check";

/**
 * Edge-level gate for /admin/* - defense in depth alongside the check that
 * already lives in app/admin/layout.tsx. This runs before any admin page
 * renders, so even a future admin route added outside that layout tree is
 * still protected. Both checks use the same isSuperAdmin() (legacy
 * ADMIN_EMAILS whitelist OR a SUPER_ADMIN row in user_roles) so nobody who's
 * allowed in by one is blocked by the other.
 *
 * The instance is built from authConfig rather than imported from @/auth:
 * @/auth carries the Credentials provider, which needs node:crypto and does
 * not bundle for Edge. Reading the session cookie only needs the shared
 * config, and isSuperAdmin comes from lib/roles-check for the same reason.
 */
const { auth } = NextAuth(authConfig);

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/admin")) return;

  const email = req.auth?.user?.email;

  if (!email) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (!(await isSuperAdmin(email))) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: ["/admin/:path*"],
};
