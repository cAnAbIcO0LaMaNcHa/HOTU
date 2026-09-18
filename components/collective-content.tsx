import Link from "next/link";
import { Play } from "lucide-react";
import type { DjSet, Track } from "@/lib/db";
import { AutoTranslate } from "@/components/auto-translate";
import { formatShortDate } from "@/lib/date-utils";

/**
 * SETS y TRACKS en el perfil de un colectivo (§6).
 *
 * De dónde sale cada pieza —de la casa actual de su autor, o de un
 * placement congelado— lo resuelve la consulta. Acá no se distingue, y
 * es a propósito: para quien mira, es el contenido del colectivo. Que
 * una pieza esté ahí porque su autor tiene la casa acá hoy, o porque se
 * publicó acá con colaboradores hace un año, no le cambia nada.
 *
 * Solo lectura. El colectivo no edita el contenido de sus artistas: lo
 * edita cada DJ desde su press kit, que es donde vive. Un colectivo que
 * pudiera tocar los tracks de sus miembros sería otro modelo de permisos
 * y no es el que §6 describe.
 *
 * Cada sección vacía NO se renderiza — la regla de siempre. Un colectivo
 * cuyos artistas todavía no cargaron nada no muestra dos encabezados
 * vacíos.
 *
 * Server component: solo lee, así que no hay razón para mandarlo.
 */
export function CollectiveContent({
  sets,
  tracks,
  collectiveName,
}: {
  sets: DjSet[];
  tracks: Track[];
  collectiveName: string;
}) {
  if (sets.length === 0 && tracks.length === 0) return null;

  return (
    <>
      {sets.length > 0 && (
        <div className="mt-16">
          <h2 className="text-xl font-bold">SETS</h2>
          <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            <AutoTranslate text={`Grabaciones de los artistas de ${collectiveName}.`} />
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {sets.map((s) => (
              <div key={s.slug} className="sheen border-chrome flex items-center gap-4 p-4">
                <a
                  href={s.url}
                  aria-label={`Reproducir ${s.title}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
                >
                  <Play className="h-4 w-4 translate-x-0.5" />
                </a>
                <div className="min-w-0 flex-1">
                  <a href={s.url} className="block truncate font-bold hover:text-primary">
                    <AutoTranslate text={s.title} />
                  </a>
                  <div className="mt-1 truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                    {/* El slug puede ser NULL: el artista se borró y la
                        fila sobrevive bajo su nombre, que es exactamente
                        para lo que el FK va ON DELETE SET NULL. */}
                    {s.artistSlug ? (
                      <Link href={`/artistas/${s.artistSlug}`} className="hover:text-primary">
                        <AutoTranslate text={s.artistName} />
                      </Link>
                    ) : (
                      <AutoTranslate text={s.artistName} />
                    )}{" "}
                    · {s.duration}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tracks.length > 0 && (
        <div className="mt-16">
          <h2 className="text-xl font-bold">TRACKS</h2>
          <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            <AutoTranslate text={`Producciones de los artistas de ${collectiveName}.`} />
          </p>

          {/* SETS y TRACKS van SEPARADOS, nunca en tabs. Misma regla que
              el press kit del DJ. */}
          <div className="mt-6 divide-y divide-border border-y border-border">
            {tracks.map((t, i) => (
              <div key={t.slug} className="flex items-center gap-4 py-4">
                <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <a
                  href={t.url}
                  aria-label={`Reproducir ${t.title}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
                >
                  <Play className="h-4 w-4 translate-x-0.5" />
                </a>
                <div className="min-w-0 flex-1">
                  <a href={t.url} className="block truncate font-bold hover:text-primary">
                    <AutoTranslate text={t.title} />
                  </a>
                  <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                    {t.artistSlug ? (
                      <Link href={`/artistas/${t.artistSlug}`} className="hover:text-primary">
                        <AutoTranslate text={t.artistName} />
                      </Link>
                    ) : (
                      <AutoTranslate text={t.artistName} />
                    )}
                    {t.label ? ` · ${t.label}` : ""}
                  </div>
                </div>
                <span className="hidden shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground sm:block">
                  {formatShortDate(t.releasedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
