import { redirect } from "next/navigation";

/**
 * /login — permanent alias for /auth/signin.
 *
 * The canonical sign-in page is /auth/signin: that is what auth.config.ts
 * declares in `pages.signIn`, what the middleware redirects to, and where
 * the Credentials form actually lives. Nothing in this repo has ever
 * pointed at /login — grep and `git log -S` both come up empty.
 *
 * It exists anyway because /login is the URL people and browsers guess.
 * A bookmark, a cached redirect or a typed address used to land on a 404,
 * which reads as "the site is broken" rather than "wrong path". Sending it
 * to the real page costs one file and removes that failure entirely.
 *
 * An alias, not a second login screen: duplicating the form would mean two
 * places to keep in sync, and the next change would only be made in one.
 */
export default async function LoginAlias({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  // Only relative callbacks travel across — an absolute one would let a
  // crafted /login?callbackUrl=https://... bounce a visitor off-site.
  const safe = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : null;
  redirect(safe ? `/auth/signin?callbackUrl=${encodeURIComponent(safe)}` : "/auth/signin");
}
