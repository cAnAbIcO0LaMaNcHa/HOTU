"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { GenreIndexEntry } from "@/lib/db";

/**
 * Los filtros de una página de listado.
 *
 * Tres controles: rama (filtro 1), tag (filtro 2) y buscador. Los tres
 * viven en contexto porque los controles están en la barra de filtros y
 * el filtrado ocurre dentro de la grilla, que son hermanos.
 *
 * Scoped por página a propósito: "el buscador busca sobre el contenido de
 * la sección donde está", así que entrar a otro listado arranca limpio.
 *
 * ============================================================
 * EL FILTRO 1 AHORA FILTRA. ANTES ORDENABA.
 * ============================================================
 *
 * Hasta la tanda 4 el filtro 1 era el de distritos y hacía push-to-top:
 * empujaba las coincidencias arriba y NUNCA escondía nada. Eso tenía
 * sentido con diez distritos que eran un universo creativo, donde la
 * gracia era destacar sin excluir.
 *
 * Con 34 ramas y 719 tags, empujar arriba deja de significar algo: elegir
 * HOUSE y seguir viendo las otras 33 abajo no es un filtro, es un orden.
 * Ahora los tres controles ACHICAN la lista, que es lo que alguien espera
 * al elegir un género.
 */
type Ctx = {
  query: string;
  setQuery: (q: string) => void;
  /** Código de rama, o "" para todas. */
  branch: string;
  setBranch: (b: string) => void;
  /** Slug de tag, o "" para todos. */
  tag: string;
  setTag: (t: string) => void;
  /** El filtro 2 de las páginas SIN género (etiqueta, ciudad...). */
  secondary: string;
  setSecondary: (v: string) => void;
  /** True cuando algo está achicando la lista. */
  active: boolean;
};

const ListingFilterContext = createContext<Ctx | null>(null);

/**
 * `initialBranch` viene del servidor, no de useSearchParams.
 *
 * La home linkea a /artistas?g=TEC, y la página lee ese searchParam en
 * el server component y lo baja como prop. Leerlo con un hook en el
 * cliente costaría un Suspense y, si se leyera en el inicializador del
 * useState, un mismatch de hidratación: el servidor renderizaría el
 * filtro vacío y el cliente con valor. Bajarlo como prop no tiene
 * ninguna de las dos cosas.
 *
 * Es el valor INICIAL, no controlado: quien llega con ?g=TEC puede
 * cambiar el desplegable y el filtro lo obedece, sin que la URL le
 * discuta.
 */
export function ListingFilterProvider({
  children,
  initialBranch = "",
}: {
  children: ReactNode;
  initialBranch?: string;
}) {
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState(initialBranch);
  const [tag, setTag] = useState("");
  const [secondary, setSecondary] = useState("");

  const value = useMemo(
    () => ({
      query,
      setQuery,
      branch,
      setBranch,
      tag,
      setTag,
      secondary,
      setSecondary,
      active: query.trim() !== "" || branch !== "" || tag !== "" || secondary !== "",
    }),
    [query, branch, tag, secondary]
  );

  return (
    <ListingFilterContext.Provider value={value}>{children}</ListingFilterContext.Provider>
  );
}

export function useListingFilters(): Ctx {
  const ctx = useContext(ListingFilterContext);
  // Un listado renderizado fuera de una página de listado tiene que
  // seguir andando, así que esto degrada a "nada está filtrando".
  return (
    ctx ?? {
      query: "",
      setQuery: () => {},
      branch: "",
      setBranch: () => {},
      tag: "",
      setTag: () => {},
      secondary: "",
      setSecondary: () => {},
      active: false,
    }
  );
}

/**
 * Pliega acentos y mayúsculas para que "bogota" encuentre "Bogotá" y
 * "chia" encuentre "Chía". Sin esto el buscador es inusable en español:
 * nadie escribe el acento y el contenido está lleno.
 *
 * NFD separa la letra acentuada en base más marca combinante, y el rango
 * de abajo es exactamente el bloque de marcas combinantes, que se tira.
 */
const COMBINING = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g"
);

export function normalize(text: string): string {
  return text.normalize("NFD").replace(COMBINING, "").toLowerCase().trim();
}

/**
 * Aplica el buscador. Cada fila aporta los textos que el llamador diga.
 *
 * Todas las palabras de la búsqueda tienen que aparecer, en cualquier
 * orden, así que "camila techno" encuentra a una Camila de techno. Una
 * búsqueda vacía devuelve la lista intacta y no una lista vacía.
 */
export function applySearch<T>(
  items: T[],
  query: string,
  fields: (item: T) => (string | null | undefined)[]
): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const hay = normalize(fields(item).filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Todo lo que una grilla necesita, en una llamada: rama, tag, filtro 2 y
 * buscador. Los cuatro ACHICAN. El de rama, además, ordena adentro de lo
 * que quedó — que no es lo mismo que el push-to-top viejo, donde ordenar
 * era TODO lo que hacía y no se escondía nada.
 *
 * `genreOf` devuelve el género de una fila. En /artistas y /colectivos es
 * el propio; en /sets y /discografia es el del artista asociado, porque
 * un track no declara género: lo hereda de quien lo hizo. Las páginas
 * que no tienen género —/noticias y /eventos— simplemente no lo pasan, y
 * ahí los filtros de rama y tag no se renderizan.
 */
export function useFilteredList<T>(
  items: T[],
  opts: {
    /** Los strings que el buscador mira en cada fila. */
    search: (item: T) => (string | null | undefined)[];
    /** El género de la fila, cuando la página tiene. */
    genreOf?: (item: T) => GenreIndexEntry | undefined;
    /** El filtro 2 de las páginas sin género. */
    secondaryOf?: (item: T) => string | null | undefined;
  }
): T[] {
  const { query, branch, tag, secondary } = useListingFilters();

  return useMemo(() => {
    let out = items;

    if (branch && opts.genreOf) {
      // La rama elegida cuenta como primaria o como secundaria: un perfil
      // que IMPRIME ACID en su press kit tiene que salir al filtrar ACID,
      // aunque su primaria sea TECHNO. No salir sería mentirle a quien
      // buscó justo lo que el perfil dice que hace.
      out = out.filter((i) => {
        const g = opts.genreOf!(i);
        return !!g && (g.branch === branch || g.secondary.includes(branch));
      });
      // Y adentro del resultado, primero los que la tienen de primaria.
      // Eso es lo que hace que elegir una rama siga significando algo:
      // arriba está quien SE DEFINE por ella, abajo quien la toca. El
      // sort de JS es estable, así que dentro de cada grupo se conserva
      // el orden que traía la página.
      out = [...out].sort(
        (a, b) =>
          (opts.genreOf!(a)?.branch === branch ? 0 : 1) -
          (opts.genreOf!(b)?.branch === branch ? 0 : 1)
      );
    }
    if (tag && opts.genreOf) {
      out = out.filter((i) => opts.genreOf!(i)?.tags.includes(tag));
    }
    if (secondary && opts.secondaryOf) {
      const want = normalize(secondary);
      out = out.filter((i) => normalize(String(opts.secondaryOf!(i) ?? "")) === want);
    }
    return applySearch(out, query, opts.search);
    // opts se reconstruye en cada render del llamador, así que depender
    // de él recalcularía siempre y anularía el memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, branch, tag, secondary]);
}
