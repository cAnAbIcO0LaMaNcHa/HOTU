import { getAllNews } from "@/lib/db";
import { COUNTRY_CODES } from "@/lib/roles";
import { DISTRICTS } from "@/lib/districts";
import { createNews, updateNews, deleteNews } from "@/lib/db-write";

export const revalidate = 0;

const inputCls = "w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none";
const labelCls = "font-mono text-[10px] tracking-widest text-muted-foreground";
const TAGS = ["RELEASE", "GEAR", "CLUB", "ARTISTA", "EVENTO"];
const STATUS = ["published", "draft", "archived"];
const STATUS_LABEL: Record<string, string> = { published: "PUBLICADO", draft: "BORRADOR", archived: "ARCHIVADO" };

function MetaFields({ n }: { n?: { scope: string; countryCode: string; language: string; status: string; featured: boolean } }) {
  return (
    <>
      <label className="block">
        <span className={labelCls}>ALCANCE</span>
        <select name="scope" defaultValue={n?.scope ?? "country"} className={inputCls}>
          <option value="country">PAÍS</option>
          <option value="global">GLOBAL</option>
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>PAÍS (si alcance = país)</span>
        <select name="countryCode" defaultValue={n?.countryCode || "COL"} className={inputCls}>
          {COUNTRY_CODES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>IDIOMA</span>
        <select name="language" defaultValue={n?.language ?? "es"} className={inputCls}>
          <option value="es">ESPAÑOL</option>
          <option value="en">ENGLISH</option>
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>ESTADO</span>
        <select name="status" defaultValue={n?.status ?? "published"} className={inputCls}>
          {STATUS.map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
        </select>
      </label>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" name="featured" defaultChecked={n?.featured ?? false} />
        <span className={labelCls}>DESTACAR EN EL HOME</span>
      </label>
    </>
  );
}

export default async function AdminNoticias() {
  const news = await getAllNews({ includeAll: true });

  return (
    <div className="space-y-12">
      <div className="border border-primary p-6">
        <h2 className="text-xl font-bold">NUEVA NOTICIA</h2>
        <form action={createNews} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>ETIQUETA</span><select name="tag" required className={inputCls}>{TAGS.map((t) => (<option key={t} value={t}>{t}</option>))}</select></label>
          <label className="block"><span className={labelCls}>DISTRITO</span><select name="district" required className={inputCls}>{DISTRICTS.map((d) => (<option key={d.id} value={d.id}>{d.title} · {d.genre}</option>))}</select></label>
          <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" required className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" required className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>RESUMEN</span><textarea name="excerpt" required rows={3} className={inputCls} /></label>
          <MetaFields />
          <button type="submit" className="sm:col-span-2 px-6 py-3 font-mono text-xs tracking-widest surface-chrome">PUBLICAR NOTICIA</button>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-bold">NOTICIAS ({news.length})</h2>
        <div className="mt-6 space-y-6">
          {news.map((n) => (
            <div key={n.id} className="border border-border bg-card p-6">
              <div className="mb-3 flex flex-wrap gap-2">
                <span className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${n.status === "published" ? "border-primary text-primary" : "border-muted-foreground text-muted-foreground"}`}>
                  {STATUS_LABEL[n.status] ?? n.status.toUpperCase()}
                </span>
                {n.featured && <span className="border border-yellow-400/60 px-2 py-1 font-mono text-[9px] tracking-widest text-yellow-400">DESTACADA</span>}
                <span className="border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                  {n.scope === "global" ? "GLOBAL" : n.countryCode} · {n.language.toUpperCase()}
                </span>
              </div>
              <form action={updateNews} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={n.id} />
                <label className="block"><span className={labelCls}>ETIQUETA</span><select name="tag" defaultValue={n.tag} required className={inputCls}>{TAGS.map((t) => (<option key={t} value={t}>{t}</option>))}</select></label>
                <label className="block"><span className={labelCls}>DISTRITO</span><select name="district" defaultValue={n.district} required className={inputCls}>{DISTRICTS.map((d) => (<option key={d.id} value={d.id}>{d.title} · {d.genre}</option>))}</select></label>
                <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" defaultValue={n.date} required className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" defaultValue={n.title} required className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>RESUMEN</span><textarea name="excerpt" defaultValue={n.excerpt} required rows={3} className={inputCls} /></label>
                <MetaFields n={n} />
                <button type="submit" className="border border-primary px-4 py-2 font-mono text-xs tracking-widest text-primary">GUARDAR CAMBIOS</button>
              </form>
              <form action={deleteNews} className="mt-3">
                <input type="hidden" name="id" value={n.id} />
                <button type="submit" className="border border-red-400/50 px-4 py-2 font-mono text-xs tracking-widest text-red-400 hover:border-red-400">BORRAR</button>
              </form>
            </div>
          ))}
          {news.length === 0 && (<p className="font-mono text-sm text-muted-foreground">No hay noticias todavía.</p>)}
        </div>
      </div>
    </div>
  );
}
