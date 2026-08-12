import { signOut } from "@/auth";

export default function SignOutPage() {
  return (
    <main className="concrete flex min-h-screen items-center justify-center px-4">
      <div className="border-chrome sheen w-full max-w-sm p-10 text-center">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          / SALIDA
        </div>
        <h1 className="mt-3 text-2xl font-bold text-chrome md:text-3xl">
          ¿CERRAR SESIÓN?
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Vas a salir de tu cuenta en HOTU.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="surface-chrome sheen w-full py-3 font-mono text-[11px] font-bold tracking-[0.2em]"
          >
            CERRAR SESIÓN
          </button>
        </form>
      </div>
    </main>
  );
}
