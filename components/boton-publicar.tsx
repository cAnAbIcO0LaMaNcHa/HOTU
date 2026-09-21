"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Plus, X } from "lucide-react";
import { PublicarEvento, type DestinoPublicacion } from "./publicar-evento";
import { PublicarNoticia } from "./publicar-noticia";

/**
 * EL "+" — el botón de publicar (tanda 5 §3).
 *
 * ============================================================
 * OFRECE LO QUE ESTA CUENTA PUEDE HACER, NO UN MENÚ FIJO
 * ============================================================
 *
 * Cada panel arma su lista: el de ARTISTA ofrece subir un set o un
 * track, el de COLECTIVO y el de VENUE ofrecen publicar un evento o una
 * noticia. Una opción que termina en 403 es peor que no estar: manda a
 * alguien a un formulario que no va a poder mandar, y la única
 * explicación que recibe es un error.
 *
 * Sin acciones no se renderiza nada. Ahí el panel muestra la invitación
 * al escalón anterior ("creá tu perfil de DJ"), que dice mucho más que
 * un "+" que no abre nada.
 *
 * ============================================================
 * LAS CONVOCATORIAS NO ESTÁN ACÁ
 * ============================================================
 *
 * No existe el modelo todavía y no se decide de paso. El botón no las
 * ofrece: un menú que promete algo que no se puede terminar es una
 * promesa rota, no un adelanto.
 */

export type AccionPublicar =
  /** Lleva a donde ya se hace, en vez de duplicar el formulario. */
  | { tipo: "enlace"; id: string; label: string; que: string; href: string }
  /** Abre su formulario acá mismo. */
  | { tipo: "evento"; id: string; label: string; que: string }
  | { tipo: "noticia"; id: string; label: string; que: string };

export function BotonPublicar({
  acciones,
  destinos = [],
  tagsSugeridos = [],
}: {
  acciones: AccionPublicar[];
  /** A nombre de quién se puede publicar. Vacío en el panel ARTISTA. */
  destinos?: DestinoPublicacion[];
  tagsSugeridos?: string[];
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState<"evento" | "noticia" | null>(null);
  const [destinoSlug, setDestinoSlug] = useState(destinos[0]?.slug ?? "");

  // Escape cierra lo que esté abierto, de adentro hacia afuera. Sin
  // esto, un formulario a pantalla completa en el celular no tiene
  // salida de teclado.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (form) setForm(null);
      else setMenu(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [form]);

  if (acciones.length === 0) return null;

  const destino = destinos.find((d) => d.slug === destinoSlug) ?? destinos[0] ?? null;

  function terminar() {
    setForm(null);
    setMenu(false);
    router.refresh();
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-expanded={menu}
          className="surface-chrome sheen inline-flex items-center gap-2 px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em]"
        >
          <Plus className={`h-4 w-4 transition-transform ${menu ? "rotate-45" : ""}`} />
          PUBLICAR
        </button>
        {!menu && !form && (
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
            {acciones.map((a) => a.label).join(" · ")}
          </span>
        )}
      </div>

      {/* El menú: cada opción dice QUÉ hace, no solo cómo se llama. */}
      {menu && !form && (
        <div className="mt-3 border border-border">
          {acciones.map((a) =>
            a.tipo === "enlace" ? (
              <Link
                key={a.id}
                href={a.href}
                className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-b-0 hover:border-primary"
              >
                <span>
                  <span className="block font-mono text-[11px] font-bold tracking-[0.2em]">
                    {a.label}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {a.que}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
              </Link>
            ) : (
              <button
                key={a.id}
                type="button"
                onClick={() => setForm(a.tipo)}
                className="flex w-full items-center justify-between gap-4 border-b border-border p-4 text-left last:border-b-0 hover:border-primary"
              >
                <span>
                  <span className="block font-mono text-[11px] font-bold tracking-[0.2em]">
                    {a.label}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {a.que}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
              </button>
            )
          )}
        </div>
      )}

      {form && destino && (
        <div className="border-chrome mt-3 p-5">
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <h3 className="font-mono text-[10px] tracking-[0.3em] text-primary">
              {form === "evento" ? "PUBLICAR UN EVENTO" : "PUBLICAR UNA NOTICIA"}
            </h3>
            <button
              type="button"
              onClick={() => setForm(null)}
              aria-label="Cerrar"
              className="text-muted-foreground hover:text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/*
            El selector solo aparece si de verdad hay dónde elegir.

            Hoy NUNCA aparece, y conviene que quede escrito por qué se
            deja igual: los destinos salen de getCollectivesOwnedBy, que
            filtra por owner_email, y createCollective admite uno por
            cuenta y por tipo. Ni siquiera un SUPER_ADMIN ve más de uno
            acá — puede publicar a nombre de cualquiera por API, pero su
            panel muestra lo que es suyo.

            Queda porque la alternativa no es "sacar código muerto", es
            "publicar a nombre del primero de la lista sin avisar" el día
            que una cuenta administre dos, que un traspaso de dueño
            alcanza para producir. Ese día esto es lo único que evita
            firmar con el nombre equivocado.
          */}
          {destinos.length > 1 && (
            <label className="mt-4 block">
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                A NOMBRE DE
              </span>
              <select
                value={destino.slug}
                onChange={(e) => setDestinoSlug(e.target.value)}
                className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              >
                {destinos.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="mt-4">
            {form === "evento" ? (
              <PublicarEvento
                destino={destino}
                onListo={terminar}
                onCancelar={() => setForm(null)}
              />
            ) : (
              <PublicarNoticia
                destino={destino}
                tagsSugeridos={tagsSugeridos}
                onListo={terminar}
                onCancelar={() => setForm(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
