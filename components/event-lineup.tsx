import Link from "next/link";
import type { LineupEntry } from "@/lib/db";

/**
 * El lineup de un evento (§7). Los nombres que se resolvieron son links;
 * los que no, texto plano.
 *
 * ============================================================
 * SE TIENE QUE VER IGUAL QUE ANTES
 * ============================================================
 *
 * Hasta ahora esto era una sola frase de texto libre — "Nina Acid ·
 * Subsuelo DJs · HOTU Residents"— y así se sigue viendo: los mismos
 * nombres, en el mismo orden. Lo único que cambia es que algunos ahora se
 * pueden tocar.
 *
 * UNA SALVEDAD, DICHA Y NO ESCONDIDA: el separador se normaliza a "·".
 * De los tres eventos publicados, dos ya lo usaban y uno usaba " - ", así
 * que ese cambia. Es deliberado: ahora esto es una relación y no una
 * frase, y el separador pasó a ser una decisión de presentación —"·" es
 * el que la página ya usa en todos lados, como en "{ciudad} · {venue}"—.
 * Arrastrar " - " para siempre sería conservar un resto de la era del
 * texto libre adentro de lo que vino a reemplazarla. Los NOMBRES no se
 * tocan: salen verbatim de raw_name.
 *
 * UN NOMBRE SIN RESOLVER SE VE COMO TEXTO, NO COMO UN LINK ROTO. "HOTU
 * Crew" no corresponde a nadie en la base y probablemente nunca
 * corresponda; un link que lleva a un 404 es peor que no tener link,
 * porque promete algo que no está. Se ve exactamente como se veía antes:
 * texto.
 *
 * ============================================================
 * SIN ENTRADAS, CAE AL TEXTO CONGELADO
 * ============================================================
 *
 * Entre que la migración corre en main y el import corre, los eventos no
 * tienen una sola entrada en event_lineup. Si este componente
 * renderizara vacío en ese hueco, /eventos perdería el lineup de todas
 * sus tarjetas por el tiempo que dure — y una transición no deja una
 * página peor que antes.
 *
 * Por eso `entries` vacío no es "no hay lineup": es "todavía no se
 * importó", y se muestra events.lineup, que quedó congelada justamente
 * para esto.
 *
 * Server component: solo lee.
 */
export function EventLineup({
  entries,
  /** El texto congelado de events.lineup, que es el suplente. */
  fallback,
  className,
}: {
  entries: LineupEntry[] | undefined;
  fallback: string;
  className?: string;
}) {
  if (!entries || entries.length === 0) {
    // SIN AutoTranslate, y eso cambia respecto de /eventos, que antes sí
    // traducía este texto. Un lineup son NOMBRES PROPIOS y no se
    // traducen: "Subsuelo DJs" es como se llaman, no una frase. Y sobre
    // todo, los nombres resueltos de abajo salen crudos, así que
    // traducir solo el suplente hacía que el mismo evento se viera
    // distinto en inglés según si ya se había importado o no.
    return <span className={className}>{fallback}</span>;
  }

  return (
    <span className={className}>
      {entries.map((e, i) => {
        const href = e.artistSlug
          ? `/artistas/${e.artistSlug}`
          : e.collectiveSlug
            ? `/colectivos/${e.collectiveSlug}`
            : null;

        return (
          <span key={`${e.rawName}-${i}`}>
            {/* El separador va ANTES de cada entrada menos la primera, y
                no después de cada una: así no queda un "·" colgando al
                final, que es lo que pasa cuando se junta con un join. */}
            {i > 0 && <span aria-hidden="true"> · </span>}
            {href ? (
              <Link href={href} className="hover:text-primary hover:underline">
                {e.rawName}
              </Link>
            ) : (
              // Sin resolver: texto pelado. Ni link, ni cursor de mano,
              // ni subrayado — nada que sugiera que se puede tocar.
              <span>{e.rawName}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}
