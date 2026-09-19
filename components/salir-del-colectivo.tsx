"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

/**
 * SALIRME de un colectivo o venue que integro.
 *
 * Hasta acá cerrar una membresía era decisión del colectivo y nada más,
 * así que un DJ no tenía forma de irse de un grupo al que había entrado.
 * Entrar sigue necesitando las dos partes —nadie te suma sin que
 * aceptes—; salir no lo necesita de ninguno de los dos lados.
 *
 * PIDE CONFIRMACIÓN, y no por costumbre: el histórico es inmutable, así
 * que salirte cierra el vínculo con to_date y volver a entrar exige que
 * el colectivo te acepte de nuevo. No es un interruptor, es una puerta.
 *
 * Si el que dejás es tu CASA lo dice explícitamente, porque eso además
 * te deja sin casa: tu contenido propio deja de aparecer en ningún
 * colectivo hasta que tengas otra.
 */
export function SalirDelColectivo({
  collectiveSlug,
  collectiveName,
  artistSlug,
  esCasa,
}: {
  collectiveSlug: string;
  collectiveName: string;
  artistSlug: string;
  esCasa: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function salir() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/collectives/${encodeURIComponent(collectiveSlug)}/members/${encodeURIComponent(artistSlug)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo salir (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo salir. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="inline-flex shrink-0 items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary"
      >
        <LogOut className="h-3 w-3" /> SALIRME
      </button>
    );
  }

  return (
    <div className="w-full">
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        ¿Salir de <strong className="text-foreground">{collectiveName}</strong>?
        {esCasa && (
          <>
            {" "}
            <strong className="text-primary">Es tu casa</strong>, así que además vas a quedarte
            sin casa: tus sets y tracks propios dejan de aparecer en ningún colectivo hasta que
            tengas otra.
          </>
        )}{" "}
        Para volver a entrar, el {collectiveName} te va a tener que aceptar de nuevo.
      </p>
      {error && <p className="mt-2 font-mono text-[10px] text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={salir}
          className="border border-red-400/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-red-400 hover:bg-red-400/10 disabled:opacity-50"
        >
          {busy ? "SALIENDO..." : "SÍ, SALIRME"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmando(false)}
          className="border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
        >
          CANCELAR
        </button>
      </div>
    </div>
  );
}
