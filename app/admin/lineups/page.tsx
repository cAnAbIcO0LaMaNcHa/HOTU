import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { EventLineupEditor } from "@/components/event-lineup-editor";
import {
  formatShortDate,
  getAllArtists,
  getAllCollectives,
  getAllEvents,
  getLineupsByEvent,
  getLineupsPendientes,
} from "@/lib/db";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Lineups por enganchar",
  robots: { index: false, follow: false },
};

/**
 * /admin/lineups — enganchar el line up de un evento con perfiles reales.
 *
 * ============================================================
 * ESTO SOBREVIVIÓ AL VACIADO DEL ADMIN, Y POR QUÉ
 * ============================================================
 *
 * Vivía adentro del formulario de edición de eventos, que se fue con el
 * CMS. Pero esto NO es crear ni editar contenido: el texto del line up
 * lo escribe quien publica la fiesta, y acá solo se dice a QUIÉN
 * corresponde cada nombre.
 *
 * De ese enganche depende que un toque aparezca en el press kit del DJ y
 * cuente en sus números de convocatoria — que es el valor entero del
 * press kit. Es curaduría de datos, del mismo lado que moderar.
 *
 * Y con los eventos de la comunidad hay MÁS lineups que enganchar, no
 * menos: antes los cargaba una sola persona.
 *
 * Es su propia cola: solo los eventos sin revisar. Los revisados
 * desaparecen de acá, igual que una noticia aprobada desaparece de la
 * suya.
 */
export default async function AdminLineupsPage() {
  const pendientes = await getLineupsPendientes();

  if (pendientes.length === 0) {
    return (
      <section>
        <h1 className="text-3xl font-bold">LINEUPS POR ENGANCHAR</h1>
        <div className="mt-10 border border-dashed border-border p-8 text-center">
          <Check className="mx-auto h-5 w-5 text-primary" />
          <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-muted-foreground">
            NO QUEDA NINGUNO
          </p>
          <p className="mx-auto mt-2 max-w-md font-mono text-[10px] leading-relaxed text-muted-foreground">
            Todos los eventos publicados tienen su line up revisado. Cuando alguien
            publique una fiesta nueva, aparece acá.
          </p>
        </div>
      </section>
    );
  }

  /**
   * Todo de a una consulta, no una por evento: cada sql del driver HTTP
   * de Neon es su propio round-trip, y esta pantalla puede tener veinte
   * eventos.
   *
   * Los candidatos son artistas y colectivos, SIN venues: un venue
   * organiza pero no toca. Es el mismo criterio que tenía el editor
   * cuando vivía en /admin/eventos.
   */
  const [artistas, colectivos, eventos, mapaEntradas] = await Promise.all([
    getAllArtists({ includeAll: true }),
    getAllCollectives({ includeAll: true }),
    getAllEvents({ includeAll: true }),
    getLineupsByEvent(pendientes.map((p) => p.id)),
  ]);
  const candidatos = [
    ...artistas.map((a) => ({ slug: a.slug, name: a.name, kind: "artist" as const })),
    ...colectivos.map((c) => ({ slug: c.slug, name: c.name, kind: "collective" as const })),
  ].sort((x, y) => x.name.localeCompare(y.name, "es"));
  const porId = new Map(eventos.map((e) => [e.id, e]));

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">LINEUPS POR ENGANCHAR</h1>
        <span className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          {pendientes.length} SIN REVISAR
        </span>
      </div>
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
        El LINE UP de un evento es texto del flyer: para HOTU son letras. Enganchar
        cada nombre con su perfil es lo que hace que el toque le aparezca al DJ en su
        press kit y cuente en sus números. Lo que quede sin resolver no engancha con
        nadie y no rompe nada.
      </p>

      <div className="mt-8 space-y-8">
        {pendientes.map((p) => {
          const e = porId.get(p.id);
          return (
            <article key={p.id} className="border-chrome p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
                <h2 className="text-xl font-bold">{p.title}</h2>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                  {formatShortDate(p.date)}
                  {e?.organizerSlug ? ` · ${e.organizerSlug.toUpperCase()}` : " · SIN ORGANIZADOR"}
                </span>
              </div>
              <EventLineupEditor
                eventId={p.id}
                entries={mapaEntradas.get(p.id) ?? []}
                lineupTexto={p.lineup}
                candidatos={candidatos}
                revisadoEn={null}
              />
              <Link
                href={`/eventos`}
                className="mt-3 inline-block font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary"
              >
                VER EN EL SITIO →
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
