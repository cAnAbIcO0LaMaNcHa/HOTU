import { getAllEvents } from "@/lib/db";
import { DISTRICTS } from "@/lib/districts";
import { COUNTRY_CODES } from "@/lib/roles";
import { createEvent, updateEvent, deleteEvent } from "@/lib/db-write";

export const revalidate = 0;

const inputCls = "w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none";
const labelCls = "font-mono text-[10px] tracking-widest text-muted-foreground";
const STATUS = ["published", "draft", "archived"];
const STATUS_LABEL: Record<string, string> = { published: "PUBLICADO", draft: "BORRADOR", archived: "ARCHIVADO" };

function MetaFields({ e }: { e?: { scope: string; countryCode: string; language: string; status: string; featured: boolean } }) {
  return (
    <>
      <label className="block">
        <span className={labelCls}>ALCANCE</span>
        <select name="scope" defaultValue={e?.scope ?? "country"} className={inputCls}>
          <option value="country">PAÍS</option>
          <option value="global">GLOBAL</option>
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>PAÍS (si alcance = país)</span>
        <select name="countryCode" defaultValue={e?.countryCode || "COL"} className={inputCls}>
          {COUNTRY_CODES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>IDIOMA</span>
        <select name="language" defaultValue={e?.language ?? "es"} className={inputCls}>
          <option value="es">ESPAÑOL</option>
          <option value="en">ENGLISH</option>
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>ESTADO</span>
        <select name="status" defaultValue={e?.status ?? "published"} className={inputCls}>
          {STATUS.map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
        </select>
      </label>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" name="featured" defaultChecked={e?.featured ?? false} />
        <span className={labelCls}>DESTACAR EN EL HOME</span>
      </label>
    </>
  );
}

export default async function AdminEventos() {
  const events = await getAllEvents({ includeAll: true });

  return (
    <div className="space-y-12">
      <div className="border border-primary p-6">
        <h2 className="text-xl font-bold">NUEVO EVENTO</h2>
        <form action={createEvent} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" required className={inputCls} /></label>
          <label className="block"><span className={labelCls}>CIUDAD</span><input type="text" name="city" required placeholder="BOGOTÁ" className={inputCls} /></label>
          <label className="block"><span className={labelCls}>LUGAR</span><input type="text" name="venue" required placeholder="Bodega 38" className={inputCls} /></label>
          <label className="block"><span className={labelCls}>DISTRITO</span><select name="district" required className={inputCls}>{DISTRICTS.map((d) => (<option key={d.id} value={d.id}>{d.title} · {d.genre}</option>))}</select></label>
          <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" required placeholder="HOTU PRIME · NOCHE 01" className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>LINE-UP</span><input type="text" name="lineup" required placeholder="Nina Acid · Subsuelo DJs" className={inputCls} /></label>
          <MetaFields />
          <button type="submit" className="sm:col-span-2 px-6 py-3 font-mono text-xs tracking-widest surface-chrome">CREAR EVENTO</button>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-bold">EVENTOS ({events.length})</h2>
        <div className="mt-6 space-y-6">
          {events.map((e) => (
            <div key={e.id} className="border border-border bg-card p-6">
              <div className="mb-3 flex flex-wrap gap-2">
                <span className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${e.status === "published" ? "border-primary text-primary" : "border-muted-foreground text-muted-foreground"}`}>
                  {STATUS_LABEL[e.status] ?? e.status.toUpperCase()}
                </span>
                {e.featured && <span className="border border-yellow-400/60 px-2 py-1 font-mono text-[9px] tracking-widest text-yellow-400">DESTACADO</span>}
                <span className="border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                  {e.scope === "global" ? "GLOBAL" : e.countryCode} · {e.language.toUpperCase()}
                </span>
              </div>
              <form action={updateEvent} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={e.id} />
                <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" defaultValue={e.date} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>CIUDAD</span><input type="text" name="city" defaultValue={e.city} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>LUGAR</span><input type="text" name="venue" defaultValue={e.venue} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>DISTRITO</span><select name="district" defaultValue={e.district} required className={inputCls}>{DISTRICTS.map((d) => (<option key={d.id} value={d.id}>{d.title} · {d.genre}</option>))}</select></label>
                <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" defaultValue={e.title} required className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>LINE-UP</span><input type="text" name="lineup" defaultValue={e.lineup} required className={inputCls} /></label>
                <MetaFields e={e} />
                <button type="submit" className="border border-primary px-4 py-2 font-mono text-xs tracking-widest text-primary">GUARDAR CAMBIOS</button>
              </form>
              <form action={deleteEvent} className="mt-3">
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" className="border border-red-400/50 px-4 py-2 font-mono text-xs tracking-widest text-red-400 hover:border-red-400">BORRAR</button>
              </form>
            </div>
          ))}
          {events.length === 0 && (<p className="font-mono text-sm text-muted-foreground">No hay eventos todavía.</p>)}
        </div>
      </div>
    </div>
  );
}
