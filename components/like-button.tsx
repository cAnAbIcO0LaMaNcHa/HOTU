"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Heart } from "lucide-react";

/**
 * SEGUIR, en el press kit de un artista, un colectivo o un venue (§11).
 *
 * Era ArtistLikeButton y se generalizó en vez de copiarse. No lleva una
 * sola condición de entity_kind ni de tipo de entidad: lo único que
 * cambia entre los tres casos es a qué endpoint pega y a dónde vuelve
 * después de iniciar sesión, y las dos cosas son props. Un botón con un
 * `if (esVenue)` adentro sería una copia disfrazada.
 *
 * Optimista: el corazón se llena al click y el número se mueve en el
 * acto, porque seguir a alguien es barato y esperar el round-trip se
 * siente roto. Si el request falla, los dos vuelven al último valor que
 * dio el servidor, no a uno adivinado.
 *
 * Sin sesión es un LINK para entrar, no un botón muerto: el número se
 * muestra igual, porque es la audiencia de quien lo tiene y es pública
 * de todos modos.
 *
 * Un like NO es un voto. No cambia ranking, orden ni exposición en
 * ningún lado. Sirve para avisarle al usuario cuando esa persona toca, y
 * para que vea cuánta gente sigue su trabajo.
 */
export function LikeButton({
  endpoint,
  returnTo,
  initialLiked,
  initialCount,
  signedIn,
}: {
  /** La ruta de API, ya armada: /api/likes/artists/x o /api/likes/collectives/x */
  endpoint: string;
  /** A dónde volver después de iniciar sesión. */
  returnTo: string;
  initialLiked: boolean;
  initialCount: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  const label = count === 1 ? "PERSONA SIGUE" : "PERSONAS SIGUEN";

  if (!signedIn) {
    return (
      <Link
        href={`/auth/signin?callbackUrl=${encodeURIComponent(returnTo)}`}
        className="inline-flex items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Heart className="h-3 w-3" /> SEGUIR
        {count > 0 && <span className="text-foreground/70">· {count}</span>}
      </Link>
    );
  }

  async function toggle() {
    const next = !liked;
    // Se mueve primero y se reconcilia después.
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: next ? "POST" : "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLiked(!next);
        setCount(initialCount);
        return;
      }
      // El número del servidor manda: alguien más pudo seguir mientras
      // este click estaba en vuelo.
      if (typeof data.count === "number") setCount(data.count);
      // Para que la sección "que me gustan" del perfil lo refleje ya.
      router.refresh();
    } catch {
      setLiked(!next);
      setCount(initialCount);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={liked}
      className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] disabled:opacity-50 ${
        liked
          ? "border-primary text-primary"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      <Heart className={`h-3 w-3 ${liked ? "fill-current" : ""}`} />
      {liked ? "SIGUIENDO" : "SEGUIR"}
      {count > 0 && (
        <span className="text-foreground/70">
          · {count} {label}
        </span>
      )}
    </button>
  );
}
