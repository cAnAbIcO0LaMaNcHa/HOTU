import { getAllArtists, getAllCollectives, getAllEvents, getLineupsByEvent, getAllVenues } from "@/lib/db";
import { EventLineupEditor } from "@/components/event-lineup-editor";
import { COUNTRY_CODES } from "@/lib/roles";
import { createEvent, updateEvent, deleteEvent } from "@/lib/db-write";

export const revalidate = 0;

const inputCls = "w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none";
const labelCls = "font-mono text-[10px] tracking-widest text-muted-foreground";
const STATUS = ["published", "draft", "archived"];
const STATUS_LABEL: Record<string, string> = { published: "PUBLICADO", draft: "BORRADOR", archived: "ARCHIVADO" };

/** Converts a stored ISO timestamp to the "YYYY-MM-DDTHH:mm" shape a
 * <input type="datetime-local"> needs for its defaultValue. */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Quién organiza. Colectivos Y venues: §5 le da eventos propios al venue,
 * y organizar no es tocar.
 *
 * "SIN ASIGNAR" es una opción de verdad y va primera. Los eventos que ya
 * existen no tienen organizador —no sale del texto del flyer— y forzar a
 * elegir uno para poder guardar cualquier otro campo obligaría a inventar
 * el dato.
 */
function OrganizerField({
  organizadores,
  actual,
}: {
  organizadores: Array<{ slug: string; name: string; esVenue: boolean }>;
  actual?: string | null;
}) {
  return (
    <label className="block sm:col-span-2">
      <span className={labelCls}>ORGANIZADOR</span>
      <select name="organizerSlug" defaultValue={actual ?? ""} className={inputCls}>
        <option value="">SIN ASIGNAR</option>
        {organizadores.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
            {o.esVenue ? " · VENUE" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

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

  // Colectivos Y venues pueden organizar (§5), así que la lista junta
  // los dos. Los lineups van de a todos en una consulta, no uno por
  // evento: cada sql del driver HTTP es su propio round-trip.
  const [colectivos, venues, lineups] = await Promise.all([
    getAllCollectives({ includeAll: true }),
    getAllVenues({ includeAll: true }),
    getLineupsByEvent(events.map((e) => e.id)),
  ]);
  const organizadores = [
    ...colectivos.map((c) => ({ slug: c.slug, name: c.name, esVenue: false })),
    ...venues.map((v) => ({ slug: v.slug, name: v.name, esVenue: true })),
  ].sort((x, y) => x.name.localeCompare(y.name, "es"));

  // Para resolver entradas del lineup: artistas y colectivos, SIN venues.
  // Un venue organiza pero no toca.
  const candidatosLineup = [
    ...(await getAllArtists({ includeAll: true })).map((a) => ({
      slug: a.slug,
      name: a.name,
      kind: "artist" as const,
    })),
    ...colectivos.map((c) => ({ slug: c.slug, name: c.name, kind: "collective" as const })),
  ].sort((x, y) => x.name.localeCompare(y.name, "es"));

  return (
    <div className="space-y-12">
      <div className="border border-primary p-6">
        <h2 className="text-xl font-bold">NUEVO EVENTO</h2>
        <form action={createEvent} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" required className={inputCls} /></label>
          <label className="block">
            <span className={labelCls}>FECHA Y HORA DE CIERRE (opcional)</span>
            <input type="datetime-local" name="endAt" className={inputCls} />
          </label>
          <label className="block"><span className={labelCls}>CIUDAD</span><input type="text" name="city" required placeholder="BOGOTÁ" className={inputCls} /></label>
          <label className="block"><span className={labelCls}>LUGAR</span><input type="text" name="venue" required placeholder="Bodega 38" className={inputCls} /></label>
          <label className="block">
            <span className={labelCls}>FLYER (imagen)</span>
            <input type="file" name="flyer" accept="image/*" className={`${inputCls} file:mr-3 file:border-0 file:bg-primary file:px-3 file:py-1 file:font-mono file:text-xs`} />
          </label>
          <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" required placeholder="HOTU PRIME · NOCHE 01" className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>LINE-UP</span><input type="text" name="lineup" required placeholder="Nina Acid · Subsuelo DJs" className={inputCls} /></label>
          <OrganizerField organizadores={organizadores} />
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
                {e.flyerUrl && <span className="border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground">CON FLYER</span>}
                <span className="border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                  {e.scope === "global" ? "GLOBAL" : e.countryCode} · {e.language.toUpperCase()}
                </span>
              </div>
              {e.flyerUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.flyerUrl} alt="" className="mb-4 h-40 w-auto rounded border border-border object-cover" />
              )}
              <form action={updateEvent} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={e.id} />
                <label className="block"><span className={labelCls}>FECHA</span><input type="date" name="date" defaultValue={e.date} required className={inputCls} /></label>
                <label className="block">
                  <span className={labelCls}>FECHA Y HORA DE CIERRE (opcional)</span>
                  <input type="datetime-local" name="endAt" defaultValue={toDatetimeLocal(e.endAt)} className={inputCls} />
                </label>
                <label className="block"><span className={labelCls}>CIUDAD</span><input type="text" name="city" defaultValue={e.city} required className={inputCls} /></label>
                <label className="block"><span className={labelCls}>LUGAR</span><input type="text" name="venue" defaultValue={e.venue} required className={inputCls} /></label>
                <label className="block">
                  <span className={labelCls}>{e.flyerUrl ? "REEMPLAZAR FLYER" : "FLYER (imagen)"}</span>
                  <input type="file" name="flyer" accept="image/*" className={`${inputCls} file:mr-3 file:border-0 file:bg-primary file:px-3 file:py-1 file:font-mono file:text-xs`} />
                </label>
                <label className="block sm:col-span-2"><span className={labelCls}>TÍTULO</span><input type="text" name="title" defaultValue={e.title} required className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className={labelCls}>LINE-UP</span><input type="text" name="lineup" defaultValue={e.lineup} required className={inputCls} /></label>
                <OrganizerField organizadores={organizadores} actual={e.organizerSlug} />
                {/* El editor del lineup relacionado, fuera del <form>: se
                    guarda por su propia ruta y no con el submit del
                    evento. Anidar un form adentro de otro es HTML
                    inválido y el navegador lo desarma. */}
                <div className="sm:col-span-2">
                  <EventLineupEditor
                    eventId={e.id}
                    entries={lineups.get(e.id) ?? []}
                    lineupTexto={e.lineup}
                    candidatos={candidatosLineup}
                    revisadoEn={e.lineupReviewedAt}
                  />
                </div>
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
