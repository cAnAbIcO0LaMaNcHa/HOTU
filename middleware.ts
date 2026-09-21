import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { isModerator } from "@/lib/roles-check";

/**
 * Edge-level gate for /admin/* - defense in depth alongside the check that
 * already lives in app/admin/layout.tsx. This runs before any admin page
 * renders, so even a future admin route added outside that layout tree is
 * still protected. Both checks use the same isModerator() so nobody who's
 * allowed in by one is blocked by the other.
 *
 * isModerator and not isSuperAdmin since tanda 5 §4: /admin is the
 * moderation panel now. The pages that are NOT moderation -- ROLES and
 * PEDIDOS -- ask for SUPER_ADMIN on their own, inside.
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

  if (!(await isModerator(email))) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: ["/admin/:path*"],
};
