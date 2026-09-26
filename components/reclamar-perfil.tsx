"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound } from "lucide-react";

/**
 * EL BOTÓN RECLAMAR, en un perfil que nadie administra (§8 pieza 2).
 *
 * ============================================================
 * DOS ESTADOS QUE NO SE PUEDEN CONFUNDIR
 * ============================================================
 *
 * Sin sesión: manda a registrarse Y VUELVE ACÁ. El callbackUrl no es un
 * detalle de comodidad — sin él la persona se registra, cae en la home, y
 * tiene que acordarse de volver a buscar el perfil que estaba reclamando.
 * La mitad no vuelve.
 *
 * Con sesión: el formulario. Y lo que pide no es un "confirmar": pide que
 * la persona CUENTE quién es, porque ese texto es literalmente lo único
 * que un moderador va a tener para decidir. No hay verificación
 * automática posible: el correo del perfil no existe y su patrón se deduce
 * de la URL.
 *
 * Por eso el mínimo son 30 caracteres y el placeholder sugiere qué sirve.
 * Un "es mío" de siete letras le deja al moderador una decisión imposible.
 */
export function ReclamarPerfil({
  tipo,
  slug,
  nombre,
  haySesion,
  yaReclamado,
  razon,
  abiertos,
}: {
  tipo: "artist" | "collective";
  slug: string;
  nombre: string;
  haySesion: boolean;
  /** Este visitante ya tiene un reclamo abierto sobre este perfil. */
  yaReclamado: boolean;
  razon: "sin_dueno" | "dueno_fantasma";
  /**
   * Cuántos reclamos abiertos hay sobre este perfil, de cualquiera.
   *
   * Es el EQUIVALENTE EN PANTALLA del aviso al contact_email, y se
   * muestra en público a propósito. El destinatario de ese aviso es
   * justamente alguien que NO tiene cuenta en el perfil, así que no hay
   * ninguna bandeja donde ponérselo: la única forma de que el dueño real
   * se entere es que lo vea cualquiera que mire el perfil.
   *
   * Y no dice QUIÉN reclamó. Eso es del moderador: publicarlo invitaría
   * a discutirlo por fuera.
   */
  abiertos: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const volverA = tipo === "artist" ? `/artistas/${slug}` : `/colectivos/${slug}`;
  const MIN = 30;
  const puede = nota.trim().length >= MIN && !busy;

  if (listo || yaReclamado) {
    return (
      <div className="border border-border bg-card/40 p-4">
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Tu reclamo está esperando.</strong> Lo revisa una
          persona, así que no te podemos prometer un plazo. El estado lo ves en{" "}
          <Link href="/perfil" className="text-primary hover:underline">
            tu perfil
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="border border-primary/40 bg-primary/5 p-4">
      <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-primary">
        <KeyRound className="h-4 w-4" /> ESTE PERFIL NO TIENE DUEÑO
      </p>
      <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
        {razon === "dueno_fantasma"
          ? "Lo cargamos nosotros cuando armamos el sitio, y la cuenta que figura como dueña no la usa nadie."
          : "Nadie lo administra hoy."}{" "}
        Si {nombre} sos vos, o el colectivo es tuyo, podés reclamarlo y editarlo donde lo ves.
      </p>

      {abiertos > 0 && (
        <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-amber-400">
          Ya hay {abiertos} reclamo(s) abierto(s) sobre este perfil, esperando que un
          moderador decida. Si el perfil es tuyo y no fuiste vos, escribinos.
        </p>
      )}

      {!haySesion ? (
        <>
          <Link
            href={`/auth/registro?callbackUrl=${encodeURIComponent(volverA)}`}
            className="mt-4 inline-flex items-center gap-2 border border-primary px-4 py-2 font-mono text-[11px] tracking-widest text-primary hover:bg-primary/10"
          >
            CREAR CUENTA Y RECLAMARLO
          </Link>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            Hace falta una cuenta porque el perfil se le entrega a una cuenta. Volvés acá al
            terminar.{" "}
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(volverA)}`}
              className="text-primary hover:underline"
            >
              Ya tengo cuenta
            </Link>
          </p>
        </>
      ) : !abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-4 inline-flex items-center gap-2 border border-primary px-4 py-2 font-mono text-[11px] tracking-widest text-primary hover:bg-primary/10"
        >
          RECLAMAR ESTE PERFIL
        </button>
      ) : (
        <div className="mt-4">
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              CONTÁ QUIÉN SOS Y POR QUÉ ES TUYO
            </span>
            <textarea
              value={nota}
              disabled={busy}
              rows={5}
              onChange={(e) => setNota(e.target.value)}
              placeholder={
                "Tu nombre real, tus redes, dónde tocaste, cualquier cosa que podamos " +
                "cruzar con lo que ya está en el perfil. Esto es lo único que va a tener " +
                "un moderador para decidir."
              }
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-primary"
            />
          </label>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {nota.trim().length} de {MIN} caracteres mínimos.
          </p>

          {error && (
            <p className="mt-3 border border-red-500/50 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-400">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={!puede}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await fetch("/api/claims", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tipo, slug, nota }),
                });
                const j = await res.json();
                if (!res.ok) {
                  setError(j?.error ?? `Error ${res.status}`);
                  return;
                }
                setListo(true);
                router.refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            className="mt-3 border border-primary px-4 py-2 font-mono text-[11px] tracking-widest text-primary hover:bg-primary/10 disabled:opacity-40"
          >
            {busy ? "MANDANDO..." : "MANDAR EL RECLAMO"}
          </button>
        </div>
      )}
    </div>
  );
}
