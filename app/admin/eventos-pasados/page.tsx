import { MapPin } from "lucide-react";
import { getAllEvents, formatShortDate } from "@/lib/db";

export const revalidate = 0;

const STATUS_LABEL: Record<string, string> = {
  published: "PUBLICADO",
  draft: "BORRADOR",
  archived: "ARCHIVADO",
};

export default async function AdminEventosPasados() {
  const events = await getAllEvents({ includeAll: true });

  // An event archives itself the moment its date passes — no status flag
  // to flip, nothing to remember to do. This page just reads that back.
  const today = new Date().toISOString().slice(0, 10);
  const past = events.filter((e) => e.date < today).sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <h2 className="text-xl font-bold">EVENTOS PASADOS ({past.length})</h2>
      <p className="mt-2 max-w-2xl font-mono text-xs text-muted-foreground">
        Un evento pasa acá solo, apenas su fecha queda atrás — no hay que archivarlo a mano. Al mismo
        tiempo, sus boletas dejan de aparecer en /eventos y pasan a la sección de recuerdos de cada
        usuario.
      </p>

      <div className="mt-8 space-y-4">
        {past.map((e) => (
          <div key={e.id} className="border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs tracking-widest text-muted-foreground">
                {formatShortDate(e.date)}
              </span>
              <span className="border border-border px-2 py-1 font-mono text-[9px] tracking-widest text-muted-foreground">
                {STATUS_LABEL[e.status] ?? e.status.toUpperCase()}
              </span>
              {e.featured && (
                <span className="border border-yellow-400/60 px-2 py-1 font-mono text-[9px] tracking-widest text-yellow-400">
                  DESTACADO
                </span>
              )}
            </div>
            <h3 className="mt-2 text-lg font-bold">{e.title}</h3>
            <div className="mt-1 flex items-center gap-1 font-mono text-[10px] tracking-widest text-muted-foreground">
              <MapPin className="h-3 w-3" /> {e.city} · {e.venue}
            </div>
            <p className="mt-2 font-mono text-xs text-muted-foreground">{e.lineup}</p>
          </div>
        ))}
        {past.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground">Todavía no hay eventos pasados.</p>
        )}
      </div>
    </div>
  );
}
