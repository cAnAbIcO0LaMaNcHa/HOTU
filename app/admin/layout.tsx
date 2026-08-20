import type { Metadata } from "next";
import Link from "next/link";
import { auth, signIn } from "@/auth";
import { isSuperAdmin } from "@/lib/roles";

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

  if (!(await isSuperAdmin(email))) {
    return (
      <section className="mx-auto max-w-md px-4 py-24 text-center">
        <span className="font-mono text-[10px] tracking-[0.3em] text-red-400">/ SIN PERMISO</span>
        <h1 className="mt-3 text-3xl font-bold">ACCESO DENEGADO</h1>
        <p className="mt-4 font-mono text-sm text-muted-foreground">La cuenta {email} no tiene permisos de administrador.</p>
        <Link href="/" className="mt-6 inline-block border border-border px-4 py-3 font-mono text-xs tracking-widest hover:border-primary">VOLVER AL SITIO</Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary">/ PANEL DE ADMINISTRACIÓN</span>
          <h1 className="mt-2 text-3xl font-bold">HOTU ADMIN</h1>
        </div>
        <div className="font-mono text-[10px] tracking-widest text-muted-foreground">{email}</div>
      </div>
      <nav className="mt-6 flex flex-wrap gap-2">
        <Link href="/admin" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">INICIO</Link>
        <Link href="/admin/eventos" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">EVENTOS</Link>
        <Link href="/admin/noticias" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">NOTICIAS</Link>
        <Link href="/admin/roles" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">ROLES</Link>
        <Link href="/admin/pedidos" className="border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">PEDIDOS</Link>
        <Link href="/" className="ml-auto border border-border px-4 py-2 font-mono text-xs tracking-widest hover:border-primary">VER SITIO</Link>
      </nav>
      <div className="mt-10">{children}</div>
    </section>
  );
}
