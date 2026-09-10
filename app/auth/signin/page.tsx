import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

/**
 * Two ways in, on purpose: Google for everyone who already uses it, and
 * email + password for accounts created without it. Both land on the same
 * user_profiles row — see the signIn callback in auth.ts.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const redirectTo = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  async function googleSignIn() {
    "use server";
    await signIn("google", { redirectTo });
  }

  async function credentialsSignIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      await signIn("credentials", { email, password, redirectTo });
    } catch (err) {
      // A successful signIn throws NEXT_REDIRECT, which is not an AuthError
      // and has to keep propagating or the redirect never happens.
      if (err instanceof AuthError) {
        redirect(`/auth/signin?error=credentials`);
      }
      throw err;
    }
  }

  return (
    <main className="concrete flex min-h-screen items-center justify-center px-4">
      <div className="border-chrome sheen w-full max-w-sm p-10 text-center">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          / ACCESO
        </div>
        <h1 className="mt-3 text-2xl font-bold text-chrome md:text-3xl">
          HOUSE OF THE UNKNOWN
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Inicia sesión para continuar.
        </p>

        {/* Any error value, not just the one the server action sets. A
            failed POST straight to /api/auth/callback/credentials comes
            back as ?error=CredentialsSignin instead, and matching on a
            single string silently swallowed the message on that path. */}
        {error && (
          <p
            role="alert"
            className="mt-6 border border-primary/60 px-3 py-2 font-mono text-[11px] tracking-wider text-primary"
          >
            CORREO O CONTRASEÑA INCORRECTOS
          </p>
        )}

        <form action={credentialsSignIn} className="mt-8 space-y-3 text-left">
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              CORREO
            </span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              CONTRASEÑA
            </span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </label>
          <button
            type="submit"
            className="surface-chrome sheen w-full py-3 font-mono text-[11px] font-bold tracking-[0.2em]"
          >
            ENTRAR
          </button>
        </form>

        <div className="my-6 font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          — O —
        </div>

        <form action={googleSignIn}>
          <button
            type="submit"
            className="w-full border border-border py-3 font-mono text-[11px] font-bold tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary"
          >
            CONTINUAR CON GOOGLE
          </button>
        </form>
      </div>
    </main>
  );
}
