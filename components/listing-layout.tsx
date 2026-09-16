"use client";

import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { AutoTranslate } from "@/components/auto-translate";
import type { BranchOption } from "@/lib/db";
import { ListingFilterProvider, useListingFilters } from "@/components/listing-filters";

/**
 * The standard listing page (HOTFIX punto 3), shared by /noticias,
 * /eventos, /artistas, /colectivos, /sets and /discografia — and later by
 * /venues and /convocatorias.
 *
 * Left column, top to bottom: title, description, one row of filters,
 * content. Right column: an advertising rail running the height of the
 * page. Six pages had this shape copied six times; now there is one.
 *
 * Filtro 1 es Main/Branch y filtro 2 es Tag, los dos de la taxonomía real
 * (tanda 4 §3). Los dos ACHICAN la lista: hasta acá el filtro 1 era el de
 * distritos y solo empujaba arriba sin esconder nada, que con diez
 * distritos tenía sentido y con 34 ramas deja de tenerlo.
 *
 * Las opciones de los dos salen de lo que de verdad aparece en cada
 * página, así que un filtro nunca ofrece algo que no devuelva nada.
 *
 * A client component because the filter bar is interactive, but it takes
 * `children` — so each page's grid is still rendered by the server
 * component that read the database, and only the controls ship.
 */
export function ListingLayout({
  title,
  description,
  secondaryLabel,
  secondaryOptions = [],
  branches = [],
  tagOptions = [],
  initialBranch,
  children,
}: {
  title: string;
  description: string;
  /**
   * El filtro 2 VIEJO (etiqueta, ciudad, sector...).
   *
   * Es el suplente del tag, no su rival: si la página tiene tags que
   * ofrecer, gana el tag y este no se renderiza. Existe para las páginas
   * que todavía no tienen género —/noticias, /eventos, /venues— y como
   * red para las que sí lo tienen pero hoy no lo declaró nadie, que es
   * el caso de /colectivos. Sin la red, esa página se quedaba sin un
   * solo filtro y perdía uno que funcionaba.
   */
  secondaryLabel?: string;
  secondaryOptions?: string[];
  /**
   * Las ramas presentes en esta página. Vacío = la página no tiene
   * género y no se renderiza el filtro 1. Es el caso de /noticias y
   * /eventos: darles género propio es modelo nuevo, y para eventos la
   * respuesta sale sola cuando exista la relación evento-lineup, porque
   * el género de una fiesta es el de quienes tocan.
   */
  branches?: BranchOption[];
  /** Los tags presentes en esta página, para el filtro 2. */
  tagOptions?: { slug: string; name: string }[];
  /** Rama con la que arrancar, para llegar filtrado desde otra página. */
  initialBranch?: string;
  children: ReactNode;
}) {
  return (
    <ListingFilterProvider initialBranch={initialBranch}>
      <section className="mx-auto max-w-7xl px-4 pb-16 pt-16 md:pt-24">
        <div className="flex gap-8">
          <div className="min-w-0 flex-1">
            <h1 className="text-5xl font-bold leading-[0.9] md:text-7xl">
              <AutoTranslate text={title} />
            </h1>

            <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
              <AutoTranslate text={description} />
            </p>

            <FilterBar
              label={secondaryLabel}
              options={secondaryOptions}
              branches={branches}
              tagOptions={tagOptions}
            />

            {children}
          </div>

          <AdRail />
        </div>
      </section>
    </ListingFilterProvider>
  );
}

/**
 * One row: genre, subgenre, and the search taking whatever width is left.
 *
 * It wraps instead of scrolling sideways on a narrow screen, and the
 * search keeps a sensible minimum so it never collapses to an icon.
 */
function FilterBar({
  label,
  options,
  branches,
  tagOptions,
}: {
  label?: string;
  options: string[];
  branches: BranchOption[];
  tagOptions: { slug: string; name: string }[];
}) {
  const { query, setQuery, branch, setBranch, tag, setTag, secondary, setSecondary } =
    useListingFilters();

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {/* Filtro 1: la rama. Solo las que aparecen en esta página: un
          desplegable de 34 donde 30 no traen nada es peor que no tenerlo. */}
      {branches.length > 0 && (
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          aria-label="GÉNERO"
          className="shrink-0 border border-border bg-background px-3 py-2 font-mono text-[10px] tracking-widest hover:border-primary focus:border-primary focus:outline-none"
        >
          <option value="">GÉNERO: TODOS</option>
          {branches.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {/* Filtro 2: el tag. Mismo criterio. */}
      {tagOptions.length > 0 && (
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          aria-label="TAG"
          className="shrink-0 border border-border bg-background px-3 py-2 font-mono text-[10px] tracking-widest hover:border-primary focus:border-primary focus:outline-none"
        >
          <option value="">TAG: TODOS</option>
          {tagOptions.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name.toUpperCase()}
            </option>
          ))}
        </select>
      )}

      {/* El filtro 2 viejo, solo mientras no haya tags que ofrecer.
          El tag manda: son dos candidatos al mismo slot, nunca los dos. */}
      {tagOptions.length === 0 && label && options.length > 0 && (
        <select
          value={secondary}
          onChange={(e) => setSecondary(e.target.value)}
          aria-label={label}
          className="shrink-0 border border-border bg-background px-3 py-2 font-mono text-[10px] tracking-widest hover:border-primary focus:border-primary focus:outline-none"
        >
          <option value="">{label}: TODOS</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o.toUpperCase()}
            </option>
          ))}
        </select>
      )}

      <div className="relative min-w-[180px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar..."
          aria-label="Buscar"
          className="w-full border border-border bg-background py-2 pl-9 pr-3 font-mono text-xs hover:border-primary focus:border-primary focus:outline-none"
        />
      </div>
    </div>
  );
}

/**
 * The advertising rail: fixed width, running the full height of the page
 * however long it gets, placeholder content for now.
 *
 * Hidden below lg. At tablet and phone width there is no room beside the
 * content, and a rail squeezed into a narrow screen would push the actual
 * listing into a column too thin to read.
 *
 * The inner block is sticky so something stays in view down a long page,
 * while the frame still spans the whole height as specified.
 */
function AdRail() {
  return (
    <aside
      aria-label="Publicidad"
      className="hidden w-[260px] shrink-0 border border-dashed border-border lg:block"
    >
      <div className="sticky top-24 flex flex-col items-center gap-3 p-4 text-center">
        <span className="font-mono text-[9px] tracking-[0.3em] text-muted-foreground">
          PUBLICIDAD
        </span>
        <div className="flex h-64 w-full items-center justify-center border border-dashed border-border">
          <span className="font-mono text-[10px] text-muted-foreground">300 × 250</span>
        </div>
        <div className="flex h-64 w-full items-center justify-center border border-dashed border-border">
          <span className="font-mono text-[10px] text-muted-foreground">300 × 250</span>
        </div>
        <span className="font-mono text-[9px] leading-relaxed text-muted-foreground">
          Espacio reservado. Todavía no hay pauta conectada.
        </span>
      </div>
    </aside>
  );
}
