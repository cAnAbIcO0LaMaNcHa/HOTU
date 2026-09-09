import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

/**
 * The half of the auth config that is safe to bundle for the Edge runtime.
 *
 * middleware.ts runs on Edge and needs to read the session cookie, which
 * means it needs a NextAuth instance — but it must NOT drag in the
 * Credentials provider, because that calls node:crypto's scrypt through
 * lib/accounts.ts and Edge has no such thing. So the shared, dependency-free
 * settings live here, and auth.ts adds Credentials on top for the Node side.
 *
 * session.strategy belongs here rather than in auth.ts: middleware and the
 * app have to agree on how the session is stored, and Credentials requires
 * JWT sessions in any case.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
  },
} satisfies NextAuthConfig;
