import Link from "next/link";
import { getAllRoleAssignments, requireSuperAdmin, COUNTRY_CODES } from "@/lib/roles";
import { addRole, removeRole } from "@/lib/roles-write";

export const revalidate = 0;

const inputCls = "w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none";
const labelCls = "font-mono text-[10px] tracking-widest text-muted-foreground";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "SUPER ADMIN — todo HOTU",
  GLOBAL_EDITOR: "GLOBAL EDITOR — contenido global",
  COUNTRY_EDITOR: "COUNTRY EDITOR — un país",
};

export default async function AdminRoles() {
  const session = await requireSuperAdmin();

  if (!session) {
    return (
      <div className="border border-red-400/50 p-6">
        <h2 className="text-xl font-bold text-red-400">SIN PERMISO</h2>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          Solo un SUPER_ADMIN puede administrar roles. Tu cuenta no tiene ese nivel de acceso.
        </p>
      </div>
    );
  }

  const roles = await getAllRoleAssignments();

  return (
    <div className="space-y-12">
      <div className="border border-primary p-6">
        <h2 className="text-xl font-bold">ASIGNAR ROL</h2>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          SUPER_ADMIN puede editar todo HOTU. GLOBAL_EDITOR solo contenido con alcance global.
          COUNTRY_EDITOR solo el país que le asignes.
        </p>
        <form action={addRole} className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className={labelCls}>CORREO</span>
            <input type="email" name="email" required placeholder="editor@ejemplo.com" className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>ROL</span>
            <select name="role" required className={inputCls}>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              <option value="GLOBAL_EDITOR">GLOBAL_EDITOR</option>
              <option value="COUNTRY_EDITOR">COUNTRY_EDITOR</option>
            </select>
          </label>
          <label className="block sm:col-span-3">
            <span className={labelCls}>PAÍS (solo para COUNTRY_EDITOR)</span>
            <select name="countryCode" className={inputCls} defaultValue="">
              <option value="">— No aplica —</option>
              {COUNTRY_CODES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="sm:col-span-3 px-6 py-3 font-mono text-xs tracking-widest surface-chrome">
            ASIGNAR ROL
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-bold">ROLES ACTIVOS ({roles.length})</h2>
        <div className="mt-6 flex flex-col gap-3">
          {roles.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-4 border border-border bg-card p-4">
              <div>
                <div className="font-mono text-sm">{r.email}</div>
                <div className="mt-1 font-mono text-[10px] tracking-widest text-primary">
                  {ROLE_LABEL[r.role] ?? r.role}
                  {r.countryCode && <span className="text-muted-foreground"> · {r.countryCode}</span>}
                </div>
              </div>
              <form action={removeRole}>
                <input type="hidden" name="email" value={r.email} />
                <input type="hidden" name="role" value={r.role} />
                <input type="hidden" name="countryCode" value={r.countryCode} />
                <button type="submit" className="border border-red-400/50 px-4 py-2 font-mono text-xs tracking-widest text-red-400 hover:border-red-400">
                  QUITAR
                </button>
              </form>
            </div>
          ))}
          {roles.length === 0 && (
            <p className="font-mono text-sm text-muted-foreground">No hay roles asignados todavía.</p>
          )}
        </div>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground">
        Nota: las cuentas en la variable de entorno ADMIN_EMAILS siguen teniendo acceso total aunque no
        aparezcan en esta lista — ese mecanismo se mantiene por compatibilidad.{" "}
        <Link href="/admin" className="text-primary underline">Volver al panel</Link>
      </p>
    </div>
  );
}
