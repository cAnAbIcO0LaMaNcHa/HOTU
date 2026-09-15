"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, Clock, Disc3, MapPin, Music, X } from "lucide-react";
import type { EnRevision } from "@/lib/db";

/**
 * La cola de aprobación (ALTA-DJ pantalla 4).
 *
 * Cada tarjeta trae lo necesario para decidir SIN ABRIR EL PERFIL: foto,
 * bio entera, género, ciudad, cuántos sets y tracks tiene y desde cuándo
 * espera. Si hubiera que abrir cada uno, la cola se acumula y la
 * aprobación deja de pasar, que es el modo de fallar de todo este diseño.
 */
export function ColaRevision({ pendientes }: { pendientes: EnRevision[] }) {
  if (pendientes.length === 0) {
    return (
      <p className="mt-8 font-mono text-sm text-muted-foreground">
        No hay perfiles esperando revisión.
      </p>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      {pendientes.map((p) => (
        <Tarjeta key={p.slug} p={p} />
      ))}
    </div>
  );
}

/**
 * Cuánto lleva esperando, con el color subiendo con la espera.
 *
 * Una cola sin antigüedad visible es una cola donde lo viejo se hunde.
 * A partir de una semana se marca, y a partir de dos grita.
 */
function Espera({ dias }: { dias: number | null }) {
  if (dias === null) {
    return (
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
        SIN FECHA
      </span>
    );
  }
  const viejo = dias >= 14;
  const tibio = dias >= 7;
  const texto = dias === 0 ? "HOY" : dias === 1 ? "HACE 1 DÍA" : `HACE ${dias} DÍAS`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-widest ${
        viejo ? "text-primary" : tibio ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {viejo ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {texto}
      {viejo && " · LLEVA MUCHO"}
    </span>
  );
}

function Tarjeta({ p }: { p: EnRevision }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");

  // El motivo se exige ANTES de dejar rechazar. Si fuera opcional, la
  // mitad de los rechazos saldrían sin explicación y el DJ no sabría qué
  // corregir. La base también lo rechaza, pero para cuando la base se
  // queja ya es un error y no una guía.
  const motivoValido = motivo.trim().length >= 10;

  async function decidir(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/artists/${encodeURIComponent(p.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { action, note: motivo } : { action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  const sinMusica = p.sets + p.tracks === 0;

  return (
    <article className="border-chrome p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          {p.photo ? (
            <img
              src={p.photo}
              alt=""
              className="border-chrome h-20 w-20 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="border-chrome flex h-20 w-20 shrink-0 items-center justify-center rounded-full font-mono text-[9px] text-muted-foreground">
              SIN FOTO
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-xl font-bold leading-tight">{p.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-widest text-muted-foreground">
              <span>/{p.slug}</span>
              {p.djCode && <span className="text-foreground">CÓDIGO {p.djCode}</span>}
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {p.city}
                {p.origin && p.origin !== p.city ? ` · de ${p.origin}` : ""}
              </span>
            </div>
            {p.ownerEmail && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">{p.ownerEmail}</p>
            )}
          </div>
        </div>
        <Espera dias={p.diasEnCola} />
      </div>

      {/* Género, que es la mitad de la decisión */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {p.branchPrimario ? (
          <span className="inline-flex items-center gap-1.5 border border-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary">
            <Disc3 className="h-3 w-3" /> {p.branchPrimario}
          </span>
        ) : (
          <span className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground">
            SIN GÉNERO PRINCIPAL
          </span>
        )}
        {p.branchesSecundarios.map((b) => (
          <span
            key={b}
            className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground"
          >
            {b}
          </span>
        ))}
      </div>
      {p.tags.length > 0 && (
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {p.tags.join(" · ")}
        </p>
      )}

      {/* La bio entera, no un recorte: es con lo que se decide */}
      <p className="mt-4 whitespace-pre-line font-mono text-xs leading-relaxed">{p.bio}</p>

      <div className="mt-4 flex flex-wrap items-center gap-4 font-mono text-[10px] tracking-widest">
        <span className={sinMusica ? "text-primary" : "text-muted-foreground"}>
          <Music className="mr-1 inline h-3 w-3" />
          {p.sets} SETS · {p.tracks} TRACKS
          {sinMusica && " · NADA PARA ESCUCHAR"}
        </span>
        <Link
          href={`/artistas/${p.slug}`}
          target="_blank"
          className="text-muted-foreground underline hover:text-primary"
        >
          VER EL PERFIL COMPLETO
        </Link>
      </div>

      {p.rechazoAnterior && (
        <div className="mt-4 border-l-2 border-border pl-3">
          <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">
            SE LE RECHAZÓ ANTES POR
          </p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {p.rechazoAnterior}
          </p>
        </div>
      )}

      {/* --- decidir ------------------------------------------------ */}
      {!rechazando ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => decidir("approve")}
            disabled={busy}
            className="surface-chrome sheen inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> {busy ? "..." : "APROBAR Y PUBLICAR"}
          </button>
          <button
            type="button"
            onClick={() => setRechazando(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/70 hover:border-primary disabled:opacity-50"
          >
            <X className="h-3 w-3" /> RECHAZAR
          </button>
        </div>
      ) : (
        <div className="mt-5 border border-border p-4">
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-primary">
              QUÉ TIENE QUE CORREGIR
            </span>
            <span className="mt-1 block font-mono text-[10px] leading-relaxed text-muted-foreground">
              Lo va a leer tal cual en su perfil. Sin esto no se puede rechazar: un
              rechazo mudo es un perfil abandonado.
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              autoFocus
              disabled={busy}
              placeholder="La foto es un placeholder. Subí una foto real tuya y lo aprobamos."
              className="mt-2 w-full border border-border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-primary disabled:opacity-50"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => decidir("reject")}
              disabled={busy || !motivoValido}
              className="border border-primary px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-primary disabled:opacity-40"
            >
              {busy ? "RECHAZANDO..." : "RECHAZAR CON ESTE MOTIVO"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRechazando(false);
                setMotivo("");
                setError(null);
              }}
              disabled={busy}
              className="border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-muted-foreground hover:border-primary disabled:opacity-50"
            >
              CANCELAR
            </button>
            {!motivoValido && (
              <span className="font-mono text-[10px] text-muted-foreground">
                Escribí al menos 10 caracteres.
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}
    </article>
  );
}
