import { getAllEvents } from "@/lib/db";
import { DISTRICTS } from "@/lib/districts";
import { createEvent, updateEvent, deleteEvent } from "@/lib/db-write";

export const revalidate = 0;

const inputCls = "w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none";
const labelCls = "font-mono text-[10px] tracking-widest text-muted-foreground";

export default async function AdminEventos() {
  const events = await getAllEvents();

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
          <button type="submit" className="sm:col-span-2 px-6 py-3 font-mono text-xs tracking-widest surface-chrome">CREAR EVENTO</button>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-bold">EVENTOS PUBLICADOS ({events.length})</h2>
        <div className="mt-6 space-y-6">
          {events.map((e) => (
            <div key={e.id} className="border border-border bg-card p-6">
              <form action={updateEvent} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={e.id} />
                <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" defaultValue={e.date} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>CIUDAD</span><input type="text" name="city" defaultValue={e.city} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>LUGAR</span><input type="text" name="venue" defaultValue={e.venue} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>DISTRITO</span><select name="district" defaultValue={e.district} required className={inputCls}>{DISTRICTS.map((d) => (<option key={d.id} value={d.id}>{d.title} · {d.genre}</option>))}</select></label>
                <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" defaultValue={e.title} required className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>LINE-UP</span><input type="text" name="lineup" defaultValue={e.lineup} required className={inputCls} /></label>
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
