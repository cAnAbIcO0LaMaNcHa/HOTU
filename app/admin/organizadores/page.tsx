import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { AsignarOrganizador } from "@/components/asignar-organizador";
import { formatShortDate, getAllCollectives } from "@/lib/db";
import { eventosSinOrganizador } from "@/lib/event-organizer-write";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Eventos sin organizador",
  robots: { index: false, follow: false },
};

/**
 * /admin/organizadores — ponerle dueño a un evento huérfano.
 *
 * ============================================================
 * ES SU PROPIA COLA, Y NO UN PEDAZO DE /admin/lineups
 * ============================================================
 *
 * La tentación era agregar el selector a /admin/lineups, que ya lista eventos y ya
 * muestra "SIN ORGANIZADOR" al lado de cada uno. No va ahí: esa página es la cola
 * de los lineups SIN REVISAR, y ésta es la de los eventos SIN ORGANIZADOR. Son dos
 * conjuntos con dos criterios, y meterlo allá dejaría inalcanzable un evento sin
 * organizador cuyo lineup ya se revisó.
 *
 * Hoy en dev esos dos conjuntos coinciden —los 4 eventos sin organizador tampoco
 * están revisados— pero apoyarse en eso es apoyarse en una casualidad, y la
 * casualidad se rompe la primera vez que alguien revisa un lineup antes de asignar.
 *
 * ============================================================
 * QUÉ HAY EN JUEGO AL ASIGNAR
 * ============================================================
 *
 * No es una etiqueta. El organizador de un evento:
 *   - se lleva su lineup como CONVOCATORIA en su press kit, que es el valor
 *     entero del press kit;
 *   - puede editar el evento de ahí en adelante.
 *
 * Por eso la pantalla dice lo que va a pasar ANTES de guardar, y por eso se puede
 * revertir: una asignación equivocada le pone la convocatoria de una fiesta a
 * quien no la hizo, y sin vuelta atrás ese error queda para siempre en los números
 * de alguien.
 */
export default async function AdminOrganizadoresPage() {
  const [pendientes, colectivos, venues] = await Promise.all([
    eventosSinOrganizador(),
    getAllCollectives({ includeAll: true, kind: "collective" }),
    getAllCollectives({ includeAll: true, kind: "venue" }),
  ]);

  /**
   * UN VENUE SÍ PUEDE ORGANIZAR. Distinto del lineup, donde un venue no toca:
   * un venue produce sus propias fiestas, y el formulario de publicar ya se los
   * ofrece desde §7.
   *
   * Los CENSURADOS se filtran acá además de en el write path. Ofrecer uno haría
   * que el moderador lo elija y reciba un 409 sin entender por qué; y el write
   * path los rechaza igual, porque asignarle un evento a un perfil bajado lo
   * publica de vuelta por el costado.
   */
  const opciones = [...colectivos, ...venues]
    .filter((c) => !c.censoredAt)
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      entityKind: (c.entityKind ?? "collective") as "collective" | "venue",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">EVENTOS SIN ORGANIZADOR</h1>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Son los eventos viejos, de antes de que un evento tuviera a nombre de quién
        estar. Mientras no tengan organizador nadie puede corregirles la fecha ni el
        lugar, y su lineup no le suma convocatoria a ningún colectivo. Asignar mueve
        esos números, así que conviene mirar el lineup antes de elegir.
      </p>

      {pendientes.length === 0 ? (
        <p className="mt-10 inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <Check className="h-4 w-4 text-primary" /> Todos los eventos tienen organizador.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {pendientes.map((e) => (
            <article key={e.id} className="border-chrome p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl font-bold">{e.title}</h2>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                  {formatShortDate(e.date)} · {e.city} · {e.venue}
                </span>
              </div>

              {/* El lineup, para decidir con algo a la vista. Es el dato que dice
                  de quién es la fiesta cuando el campo está vacío. */}
              {e.lineup && (
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  LINE UP: {e.lineup}
                </p>
              )}

              <AsignarOrganizador eventId={e.id} actual={null} opciones={opciones} />

              <Link
                href="/eventos"
                className="mt-3 inline-block font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary"
              >
                VER EN EL SITIO →
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
