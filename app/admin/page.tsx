import Link from "next/link";
import { AlertTriangle, Check, EyeOff, KeyRound, ListChecks, Newspaper, UserX } from "lucide-react";
import {
  getArtistsInReview,
  getBannedAccounts,
  getCensored,
  getLineupsPendientes,
  getNewsInReview,
} from "@/lib/db";
import { getReclamosPendientes } from "@/lib/claims-write";

export const revalidate = 0;

/**
 * El inicio del admin: qué está esperando una decisión (tanda 5 §4).
 *
 * ============================================================
 * ACÁ HABÍA UN CONTADOR DE INVENTARIO. AHORA HAY UNA BANDEJA.
 * ============================================================
 *
 * Esta pantalla decía "EVENTOS 4 · NOTICIAS 3 · ARTISTAS 12" con un
 * "EDITABLE →" al lado, porque el admin era el lugar donde se cargaba
 * todo. Cuántas noticias hay en total no es una pregunta que alguien se
 * haga: es el número que sale cuando la herramienta es un CMS.
 *
 * La pregunta de un moderador es OTRA: qué está esperando que yo
 * decida. Así que los números son colas, y una cola en cero es una
 * buena noticia, no un inventario vacío.
 */
export default async function AdminHome() {
  const [djs, noticias, lineups, censuradas, baneadas, reclamos] = await Promise.all([
    getArtistsInReview(),
    getNewsInReview(),
    getLineupsPendientes(),
    getCensored(),
    getBannedAccounts(),
    getReclamosPendientes(),
  ]);

  const colas = [
    {
      label: "PERFILES DE DJ",
      n: djs.length,
      href: "/admin/artistas",
      Icono: ListChecks,
      que: "Esperando aprobación para publicarse",
    },
    {
      label: "NOTICIAS",
      n: noticias.length,
      href: "/admin/noticias",
      Icono: Newspaper,
      que: "Mandadas por colectivos y venues",
    },
    {
      label: "LINEUPS",
      n: lineups.length,
      href: "/admin/lineups",
      Icono: AlertTriangle,
      que: "Por enganchar con los perfiles de quienes tocan",
    },
    {
      // La cuarta cola NO aprueba contenido: entrega el control de un
      // perfil. Va con las otras porque es trabajo que espera una
      // decisión, y el texto dice en qué se diferencia.
      label: "RECLAMOS",
      n: reclamos.length,
      href: "/admin/reclamos",
      Icono: KeyRound,
      que: "Alguien dice que un perfil es suyo",
    },
  ];

  const hechas = [
    { label: "CENSURADO", n: censuradas.length, Icono: EyeOff },
    { label: "CUENTAS CERRADAS", n: baneadas.length, Icono: UserX },
  ];

  const pendientes = colas.reduce((t, c) => t + c.n, 0);

  return (
    <div>
      <p className="max-w-2xl font-mono text-sm leading-relaxed text-muted-foreground">
        El contenido de HOTU lo suben los DJs, los colectivos y los venues desde sus
        propios perfiles. Acá no se crea nada: se aprueba, se baja lo que no va, y se
        cierra la puerta a quien hace daño.
      </p>

      {pendientes === 0 && (
        <p className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] text-primary">
          <Check className="h-4 w-4" /> NO HAY NADA ESPERANDO
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {colas.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="sheen border-chrome block p-6 transition-colors hover:border-primary"
          >
            <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest text-primary">
              <c.Icono className="h-3 w-3" /> {c.label}
            </div>
            <div className={`mt-2 text-4xl font-bold ${c.n === 0 ? "text-muted-foreground" : ""}`}>
              {c.n}
            </div>
            <div className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {c.que}
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-10">
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          DECISIONES TOMADAS
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {hechas.map((h) => (
            <Link
              key={h.label}
              href="/admin/moderacion"
              className="block border border-border p-5 transition-colors hover:border-primary"
            >
              <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground">
                <h.Icono className="h-3 w-3" /> {h.label}
              </div>
              <div className="mt-2 text-2xl font-bold">{h.n}</div>
            </Link>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Todo se deshace con un click, y todo queda con el motivo a la vista. Una
          decisión de moderación que nadie puede revisar después es una que nadie
          audita.
        </p>
      </div>
    </div>
  );
}
