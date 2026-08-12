import { getAllNews } from "@/lib/db";
import { createNews, updateNews, deleteNews } from "@/lib/db-write";

export const revalidate = 0;

const inputCls = "w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none";
const labelCls = "font-mono text-[10px] tracking-widest text-muted-foreground";
const TAGS = ["RELEASE", "GEAR", "CLUB", "ARTISTA", "EVENTO"];

export default async function AdminNoticias() {
  const news = await getAllNews();

  return (
    <div className="space-y-12">
      <div className="border border-primary p-6">
        <h2 className="text-xl font-bold">NUEVA NOTICIA</h2>
        <form action={createNews} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>ETIQUETA</span><select name="tag" required className={inputCls}>{TAGS.map((t) => (<option key={t} value={t}>{t}</option>))}</select></label>
          <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" required className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" required className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>RESUMEN</span><textarea name="excerpt" required rows={3} className={inputCls} /></label>
          <button type="submit" className="sm:col-span-2 px-6 py-3 font-mono text-xs tracking-widest surface-chrome">PUBLICAR NOTICIA</button>
        </form>
      </div>

      <div>
        <h2 className="text-xl font-bold">NOTICIAS PUBLICADAS ({news.length})</h2>
        <div className="mt-6 space-y-6">
          {news.map((n) => (
            <div key={n.id} className="border border-border bg-card p-6">
              <form action={updateNews} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={n.id} />
                <label className="block"><span className={labelCls}>ETIQUETA</span><select name="tag" defaultValue={n.tag} required className={inputCls}>{TAGS.map((t) => (<option key={t} value={t}>{t}</option>))}</select></label>
                <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" defaultValue={n.date} required className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" defaultValue={n.title} required className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>RESUMEN</span><textarea name="excerpt" defaultValue={n.excerpt} required rows={3} className={inputCls} /></label>
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
