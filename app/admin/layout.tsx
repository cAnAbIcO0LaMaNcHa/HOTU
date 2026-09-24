import type { Metadata } from "next";
import Link from "next/link";
import { auth, signIn } from "@/auth";
import { isModerator, isSuperAdmin } from "@/lib/roles";
import { limpiezaHabilitada } from "@/lib/accounts-delete";

export const metadata: Metadata = {
  title: "Panel de administración",
  robots: { index: false, follow: false },
};

export const revalidate = 0;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    return (
      <section className="mx-auto max-w-md px-4 py-24 text-center">
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary">/ ACCESO RESTRINGIDO</span>
        <h1 className="mt-3 text-3xl font-bold">PANEL HOTU</h1>
        <p className="mt-4 font-mono text-sm text-muted-foreground">Iniciá sesión para continuar.</p>
        <form action={async () => { "use server"; await signIn("google", { redirectTo: "/admin" }); }}>
          <button type="submit" className="mt-6 w-full border border-border px-4 py-3 font-mono text-xs tracking-widest hover:border-primary">CONTINUAR CON GOOGLE</button>
        </form>
      </section>
    );
  }

  if (!(await isModerator(email))) {
    return (
      <section className="mx-auto max-w-md px-4 py-24 text-center">
        <span className="font-mono text-[10px] tracking-[0.3em] text-red-400">/ SIN PERMISO</span>
        <h1 className="mt-3 text-3xl font-bold">ACCESO DENEGADO</h1>
        <p className="mt-4 font-mono text-sm text-muted-foreground">La cuenta {email} no tiene permisos de moderación.</p>
        <Link href="/" className="mt-6 inline-block border border-border px-4 py-3 font-mono text-xs tracking-widest hover:border-primary">VOLVER AL SITIO</Link>
      </section>
    );
  }

  /**
   * El enlace a la limpieza solo existe mientras el interruptor esté
   * puesto Y quien mira sea un SUPER_ADMIN. La página se defiende sola
   * con dos notFound(), así que esto no es la guarda: es para que un
   * moderador no vea una puerta que no puede abrir.
   */
  const verLimpieza = limpiezaHabilitada() && (await isSuperAdmin(email));

  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary">/ PANEL DE ADMINISTRACIÓN</span>
          <h1 className="mt-2 text-3xl font-bold">HOTU ADMIN</h1>
        </div>
        <div className="font-mono text-[10px] tracking-widest text-muted-foreground">{email}</div>
      </div>
      {/*
        LA NAVEGACIÓN ES LA LISTA DE LO QUE ESTE PANEL HACE.

        Se fueron EVENTOS, ARCHIVO y COLECTIVOS: eran el CMS. Lo que
        queda son tres colas, la moderación, y dos cosas que no son
        moderación y piden SUPER_ADMIN por su cuenta —ROLES nombra
        moderadores, PEDIDOS emite tiquetes—, separadas a la derecha
        para que se lean como lo que son.
      */}
      <nav className="mt-6 flex flex-wrap items-center gap-2">
        <Link href="/admin" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">INICIO</Link>
        <Link href="/admin/artistas" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">DJS</Link>
        <Link href="/admin/noticias" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">NOTICIAS</Link>
        <Link href="/admin/lineups" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">LINEUPS</Link>
        <Link href="/admin/moderacion" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">MODERACIÓN</Link>
        <span className="mx-2 hidden h-4 w-px bg-border sm:block" aria-hidden />
        <Link href="/admin/roles" className="border border-border/50 px-4 py-2 font-mono text-xs tracking-widest text-muted-foreground hover:border-primary hover:text-primary">ROLES</Link>
        <Link href="/admin/pedidos" className="border border-border/50 px-4 py-2 font-mono text-xs tracking-widest text-muted-foreground hover:border-primary hover:text-primary">PEDIDOS</Link>
        {verLimpieza && (
          <Link href="/admin/limpieza" className="border border-red-500/50 px-4 py-2 font-mono text-xs tracking-widest text-red-400 hover:border-red-500">LIMPIEZA</Link>
        )}
        <Link href="/" className="ml-auto border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">VER SITIO</Link>
      </nav>
      <div className="mt-10">{children}</div>
    </section>
  );
}
