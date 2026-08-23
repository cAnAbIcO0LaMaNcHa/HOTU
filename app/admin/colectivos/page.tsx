import { getAllCollectives } from "@/lib/db";
import { COUNTRY_CODES } from "@/lib/roles";
import { DISTRICTS } from "@/lib/districts";
import { createCollective, updateCollective, deleteCollective } from "@/lib/db-write";

export const revalidate = 0;

const inputCls = "w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none";
const labelCls = "font-mono text-[10px] tracking-widest text-muted-foreground";
const TYPES = ["HOTU", "LOCAL"];
const STATUS = ["published", "draft", "archived"];
const STATUS_LABEL: Record<string, string> = { published: "PUBLICADO", draft: "BORRADOR", archived: "ARCHIVADO" };

function MetaFields({ c }: { c?: { scope: string; countryCode: string; language: string; status: string; featured: boolean } }) {
  return (
    <>
      <label className="block">
        <span className={labelCls}>ALCANCE</span>
        <select name="scope" defaultValue={c?.scope ?? "country"} className={inputCls}>
          <option value="country">PAÍS</option>
          <option value="global">GLOBAL</option>
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>PAÍS (si alcance = país)</span>
        <select name="countryCode" defaultValue={c?.countryCode || "COL"} className={inputCls}>
          {COUNTRY_CODES.map((code) => (<option key={code} value={code}>{code}</option>))}
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>IDIOMA</span>
        <select name="language" defaultValue={c?.language ?? "es"} className={inputCls}>
          <option value="es">ESPAÑOL</option>
          <option value="en">ENGLISH</option>
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>ESTADO</span>
        <select name="status" defaultValue={c?.status ?? "published"} className={inputCls}>
          {STATUS.map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
        </select>
      </label>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" name="featured" defaultChecked={c?.featured ?? false} />
        <span className={labelCls}>DESTACAR EN EL HOME</span>
      </label>
    </>
  );
}

export default async function AdminColectivos() {
  const collectives = await getAllCollectives({ includeAll: true });

  return (
    <div className="space-y-12">
      <div className="border border-primary p-6">
        <h2 className="text-xl font-bold">NUEVO COLECTIVO</h2>
        <form action={createCollective} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>SLUG (identificador único)</span><input type="text" name="slug" required placeholder="subsuelo-x" className={inputCls} /></label>
          <label className="block"><span className={labelCls}>NOMBRE</span><input type="text" name="name" required className={inputCls} /></label>
          <label className="block"><span className={labelCls}>TIPO</span><select name="type" required className={inputCls}>{TYPES.map((t) => (<option key={t} value={t}>{t === "HOTU" ? "BY HOTU" : "LOCAL"}</option>))}</select></label>
          <label className="block"><span className={labelCls}>SECTOR</span><input type="text" name="sector" required placeholder="Producción, promotoras, etc." className={inputCls} /></label>
          <label className="block"><span className={labelCls}>DISTRITO</span><select name="district" required className={inputCls}>{DISTRICTS.map((d) => (<option key={d.id} value={d.id}>{d.title} · {d.genre}</option>))}</select></label>
          <label className="block sm:col-span-2"><span className={labelCls}>BIO</span><textarea name="bio" required rows={3} className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>ARTISTAS (slugs separados por coma)</span><input type="text" name="artistSlugs" placeholder="nina-acid, subsuelo-x" className={inputCls} /></label>
          <MetaFields />
          <button type="submit" className="sm:col-span-2 px-6 py-3 font-mono text-xs tracking-widest surface-chrome">CREAR COLECTIVO</button>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-bold">COLECTIVOS ({collectives.length})</h2>
        <div className="mt-6 space-y-6">
          {collectives.map((c) => (
            <div key={c.slug} className="border border-border bg-card p-6">
              <div className="mb-3 flex flex-wrap gap-2">
                <span className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${c.status === "published" ? "border-primary text-primary" : "border-muted-foreground text-muted-foreground"}`}>
                  {STATUS_LABEL[c.status] ?? c.status.toUpperCase()}
                </span>
                {c.featured && <span className="border border-yellow-400/60 px-2 py-1 font-mono text-[9px] tracking-widest text-yellow-400">DESTACADO</span>}
                <span className="border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground">{c.slug}</span>
              </div>
              <form action={updateCollective} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="originalSlug" value={c.slug} />
                <label className="block"><span className={labelCls}>NOMBRE</span><input type="text" name="name" defaultValue={c.name} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>TIPO</span><select name="type" defaultValue={c.type} required className={inputCls}>{TYPES.map((t) => (<option key={t} value={t}>{t === "HOTU" ? "BY HOTU" : "LOCAL"}</option>))}</select></label>
                <label className="block"><span className={labelCls}>SECTOR</span><input type="text" name="sector" defaultValue={c.sector} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>DISTRITO</span><select name="district" defaultValue={c.district} required className={inputCls}>{DISTRICTS.map((d) => (<option key={d.id} value={d.id}>{d.title} · {d.genre}</option>))}</select></label>
                <label className="block sm:col-span-2"><span className={labelCls}>BIO</span><textarea name="bio" defaultValue={c.bio} required rows={3} className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>ARTISTAS (slugs separados por coma)</span><input type="text" name="artistSlugs" defaultValue={c.artistSlugs.join(", ")} className={inputCls} /></label>
                <MetaFields c={c} />
                <button type="submit" className="border border-primary px-4 py-2 font-mono text-xs tracking-widest text-primary sm:col-span-2">GUARDAR CAMBIOS</button>
              </form>
              <form action={deleteCollective} className="mt-3">
                <input type="hidden" name="slug" value={c.slug} />
                <button type="submit" className="border border-red-400/50 px-4 py-2 font-mono text-xs tracking-widest text-red-400 hover:border-red-400">BORRAR</button>
              </form>
            </div>
          ))}
          {collectives.length === 0 && (<p className="font-mono text-sm text-muted-foreground">No hay colectivos todavía.</p>)}
        </div>
      </div>
    </div>
  );
}
