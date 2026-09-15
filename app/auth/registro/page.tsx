import type { Metadata } from "next";
import Link from "next/link";
import { RegistroForm } from "@/components/registro-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Creá tu cuenta en HOTU para comprar boletas, seguir DJs y armar tu press kit.",
};

/**
 * /auth/registro — la cuenta, y nada más.
 *
 * No pide nada de artista ni de género: una sola cuenta con roles
 * activables es el modelo del proyecto, y el perfil de DJ se crea después
 * desde /perfil, que es donde ya viven CREAR COLECTIVO y CREAR VENUE.
 *
 * Google sigue estando, para quien prefiera no tener otra contraseña.
 */
export default async function RegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  // Solo destinos relativos: uno absoluto convertiría esta página en un
  // redirector abierto, igual que en /login.
  const destino = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <section className="mx-auto max-w-md px-4 pb-16 pt-16 md:pt-24">
      <h1 className="text-4xl font-bold leading-[0.95]">CREAR CUENTA</h1>
      <p className="mt-3 font-mono text-sm leading-relaxed text-muted-foreground">
        Para comprar boletas, seguir DJs y, si sos artista, armar tu press kit.
      </p>

      <div className="mt-8">
        <RegistroForm callbackUrl={destino} />
      </div>

      <p className="mt-6 font-mono text-[11px] leading-relaxed text-muted-foreground">
        También podés{" "}
        <Link
          href={`/auth/signin?callbackUrl=${encodeURIComponent(destino)}`}
          className="text-primary underline"
        >
          entrar con Google
        </Link>{" "}
        y saltearte la contraseña.
      </p>
    </section>
  );
}
