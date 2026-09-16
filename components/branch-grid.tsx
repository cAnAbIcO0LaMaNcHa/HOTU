import Link from "next/link";
import { AutoTranslate } from "@/components/auto-translate";

/**
 * Las ramas con contenido, en la home. Reemplaza a la grilla de los diez
 * distritos (tanda 4 §3).
 *
 * Tres diferencias con la que reemplaza, y las tres son la misma idea:
 *
 * 1. Los distritos eran DIEZ FIJOS. Siempre estaban los diez, hubiera o
 *    no algo detrás, así que "ENCUENTRA TU DISTRITO" podía llevarte a
 *    una página vacía. Acá una rama aparece solo si alguien la declaró.
 * 2. El orden lo decide la CANTIDAD, no un número de catálogo.
 * 3. SI NO HAY NINGUNA, NO SE RENDERIZA NADA. Ni el título, ni el
 *    encabezado, ni una grilla vacía. Es la regla del proyecto: las
 *    secciones vacías no se muestran.
 *
 * El punto 3 no es teórico. Hoy en producción la taxonomía está sembrada
 * pero ningún artista declaró género, así que este bloque no va a
 * aparecer hasta que el primero lo haga. Es el estado esperado.
 *
 * Server component a propósito: es una grilla de links, no tiene estado,
 * y el conteo lo lee la página. No hay nada que mandar al cliente.
 */
export function BranchGrid({
  branches,
}: {
  branches: { code: string; name: string; count: number }[];
}) {
  if (branches.length === 0) return null;

  return (
    <section className="py-16">
      <span className="font-mono text-[10px] tracking-[0.3em] text-primary">
        / <AutoTranslate text="EL MAPA" /> · {branches.length}{" "}
        <AutoTranslate text={branches.length === 1 ? "GÉNERO" : "GÉNEROS"} />
      </span>
      <h2 className="mt-4 text-4xl font-bold text-white md:text-5xl">
        <AutoTranslate text="ENCONTRÁ TU GÉNERO" />
      </h2>
      <p className="mt-4 max-w-2xl font-mono text-sm text-muted-foreground">
        <AutoTranslate text="Cada género es una identidad sonora. Elegí el tuyo y mirá quién lo está tocando." />
      </p>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {branches.map((b) => (
          /**
           * El link lleva el código de la rama en ?g=, y /artistas lo lee
           * del servidor para arrancar con ese filtro puesto.
           *
           * Sin eso la baldosa sería un botón que no filtra nada: te
           * dejaría en /artistas sin más, que es menos de lo que hacía la
           * grilla de distritos. Una transición no deja una página peor
           * que antes.
           */
          <Link
            key={b.code}
            href={`/artistas?g=${b.code}`}
            className="sheen border-chrome flex min-h-[110px] flex-col justify-between p-4"
          >
            <span className="font-mono text-[10px] tracking-[0.3em] text-white">
              {b.count} {b.count === 1 ? "DJ" : "DJS"}
            </span>
            <span className="mt-3 block text-lg font-bold leading-tight text-chrome">
              <AutoTranslate text={b.name} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
