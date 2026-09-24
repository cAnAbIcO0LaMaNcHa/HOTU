"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Trash2, Unlink } from "lucide-react";
import type { Eliminacion, InventarioCuenta } from "@/lib/accounts-delete";

/**
 * ELIMINAR UNA CUENTA, desde el panel de moderación (§8).
 *
 * ============================================================
 * ESTO ESTÁ DEBAJO DEL BAN, Y NO AL REVÉS
 * ============================================================
 *
 * El orden de la pantalla es una recomendación. Casi siempre lo que
 * corresponde es BANEAR: se deshace, no borra nada, y corta la sesión en
 * el momento. Eliminar es para lo que el ban no resuelve —una cuenta de
 * prueba, una que se creó por error, alguien que pide irse—, y no tiene
 * vuelta atrás.
 *
 * Por eso el bloque explica primero cuándo NO usarlo.
 *
 * ============================================================
 * NO PUEDE TOCAR PLATA, Y LA PANTALLA LO DICE ANTES
 * ============================================================
 *
 * Una cuenta con pedidos o boletas no se borra: la base se niega
 * (ON DELETE RESTRICT) y la ruta lo traduce a un mensaje. La vista previa
 * lo muestra ANTES de que alguien escriba el motivo, porque enterarse al
 * confirmar es enterarse tarde.
 *
 * ============================================================
 * EL REGISTRO SE VE ACÁ, NO SOLO EN LA LIMPIEZA
 * ============================================================
 *
 * La pantalla de limpieza pre-lanzamiento también lo lista, pero esa
 * desaparece el día del lanzamiento. Si el registro solo viviera ahí, a
 * partir de ese día nadie podría revisar una eliminación. Un borrado que
 * no se puede auditar después es un borrado que nadie auditó.
 */
export function EliminarCuenta({ eliminaciones }: { eliminaciones: Eliminacion[] }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState<"desamparar" | "ocultar">("desamparar");
  const [previa, setPrevia] = useState<InventarioCuenta | null>(null);
  /** De QUÉ email es la previa que hay en pantalla. */
  const [previaDe, setPreviaDe] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * LA VISTA PREVIA SE PIDE MIENTRAS SE ESCRIBE, NO AL SALIR DEL CAMPO.
   *
   * Misma razón que en el traspaso: en el onBlur, clickear el botón
   * dispara el blur y la respuesta puede llegar DESPUÉS de que la acción
   * ya salió. Una previa que se puede saltear no sirve para lo único que
   * hace.
   *
   * El efecto se cancela al cambiar el email, así que una respuesta vieja
   * que llegue tarde no pisa a una nueva.
   */
  useEffect(() => {
    const e = email.trim().toLowerCase();
    setPrevia(null);
    setPreviaDe("");
    setError(null);
    if (!e) return;

    let vigente = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/moderation/accounts?email=${encodeURIComponent(e)}`);
        const j = await res.json();
        if (!vigente) return;
        if (res.ok) {
          setPrevia(j);
          setPreviaDe(e);
        }
      } catch {
        /* que no aparezca previa ya es la señal: el botón sigue apagado */
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 400);

    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [email]);

  const emailNorm = email.trim().toLowerCase();
  const previaVigente = previa !== null && previaDe === emailNorm && emailNorm !== "";
  const motivoOk = motivo.trim().length >= 10;
  const tienePlata = previaVigente && (previa.pedidos > 0 || previa.boletas > 0);
  const puede = previaVigente && motivoOk && !tienePlata && !previa.esModerador && !busy;

  const eliminar = async () => {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/admin/moderation/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailNorm, motivo, destinoPerfiles: destino }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error ?? `Error ${res.status}`);
        return;
      }
      setAviso(
        `Cuenta eliminada. Registro #${j.registroId}. ` +
          (destino === "ocultar"
            ? "Sus perfiles quedaron censurados, no borrados: se puede levantar."
            : "Sus perfiles siguen publicados, sin dueño.")
      );
      setEmail("");
      setMotivo("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-16">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Trash2 className="h-4 w-4 text-red-400" />
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-red-400">
          ELIMINAR UNA CUENTA
        </h2>
      </div>

      <p className="mt-3 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
        <strong>Casi siempre lo que corresponde es banear</strong>, acá arriba: se
        deshace, no borra nada y corta la sesión en el momento. Esto es para lo que el
        ban no resuelve —una cuenta creada por error, alguien que pide irse— y{" "}
        <strong>no tiene vuelta atrás</strong>.
      </p>
      <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
        Se van la cuenta, sus likes y sus roles. Sus perfiles, los eventos y las
        noticias <strong>se quedan</strong> y pierden el dueño: hay miembros que no
        hicieron nada y gente con boletas compradas. Y si tiene pedidos o boletas
        propias, no se puede: eso es prueba de un pago.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            CUENTA (el email)
          </span>
          <input
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alguien@ejemplo.com"
            className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-red-500"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            MOTIVO (MÍNIMO 10 CARACTERES)
          </span>
          <input
            value={motivo}
            disabled={busy}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por qué se elimina"
            className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-red-500"
          />
        </label>
      </div>

      {/* ---------------- LA VISTA PREVIA ---------------- */}
      {previaVigente ? (
        <div className="mt-5 border border-border p-4">
          <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            QUÉ SE LLEVA
          </p>

          {previa.esModerador && (
            <p className="mt-3 font-mono text-[11px] text-amber-400">
              ESA CUENTA MODERA. Sacale el rol desde ROLES —que es de un SUPER_ADMIN—
              antes de eliminarla.
            </p>
          )}

          {tienePlata && (
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-red-400">
              NO SE PUEDE: tiene {previa.pedidos} pedido(s) y {previa.boletas} boleta(s).
              Son prueba de un pago. Lo que corresponde es BANEARLA, acá arriba.
            </p>
          )}

          <ul className="mt-3 space-y-1 font-mono text-[10px] text-muted-foreground">
            <li>
              SE BORRA: {previa.likes} like(s), {previa.roles.length} rol(es)
              {previa.roles.length > 0 && ` (${previa.roles.join(", ")})`}
            </li>
            <li>
              {destino === "ocultar" ? "SE OCULTA" : "QUEDA SIN DUEÑO Y VISIBLE"}:{" "}
              {previa.artistas.length > 0
                ? previa.artistas.map((a) => a.slug).join(", ")
                : "ningún artista"}
              {" · "}
              {previa.colectivos.length > 0
                ? previa.colectivos.map((c) => c.slug).join(", ")
                : "ningún colectivo"}
              {destino === "ocultar" &&
                previa.setsYTracks > 0 &&
                ` · ${previa.setsYTracks} set(s)/track(s)`}
            </li>
            {previa.marcasDeModeracion > 0 && (
              <li>
                QUEDAN SIN FIRMA: {previa.marcasDeModeracion} marca(s) de moderación
                suya(s)
              </li>
            )}
            {previa.cesionesAbiertas > 0 && (
              <li>SE REVOCAN: {previa.cesionesAbiertas} cesión(es) abierta(s)</li>
            )}
            {previa.baneada && <li className="text-amber-400">HOY ESTÁ BANEADA</li>}
            {previa.fantasma && <li>Es una cuenta fantasma: no puede entrar por ninguna vía.</li>}
          </ul>
        </div>
      ) : (
        email.trim() !== "" && (
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            {buscando
              ? "Buscando esa cuenta..."
              : "No encontré esa cuenta. El botón se habilita cuando aparezca acá qué se lleva."}
          </p>
        )
      )}

      {/* ---------------- QUÉ PASA CON LOS PERFILES ---------------- */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setDestino("desamparar")}
          className={`border p-4 text-left ${
            destino === "desamparar" ? "border-primary" : "border-border hover:border-primary/50"
          }`}
        >
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em]">
            <Unlink className="h-4 w-4" /> DEJARLOS DESAMPARADOS
          </span>
          <span className="mt-2 block font-mono text-[10px] leading-relaxed text-muted-foreground">
            Siguen publicados y visibles, sin dueño, y alguien los puede reclamar
            después. Es lo que pasa solo.
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDestino("ocultar")}
          className={`border p-4 text-left ${
            destino === "ocultar" ? "border-primary" : "border-border hover:border-primary/50"
          }`}
        >
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em]">
            <EyeOff className="h-4 w-4" /> OCULTARLOS
          </span>
          <span className="mt-2 block font-mono text-[10px] leading-relaxed text-muted-foreground">
            Se censuran con este motivo, junto con sus sets y tracks. No se borran: se
            puede levantar. Los eventos y noticias del colectivo NO se tocan.
          </span>
        </button>
      </div>

      {error && (
        <p className="mt-4 border border-red-500/50 bg-red-500/5 px-4 py-3 font-mono text-[11px] text-red-400">
          {error}
        </p>
      )}
      {aviso && (
        <p className="mt-4 border border-border px-4 py-3 font-mono text-[11px] text-muted-foreground">
          {aviso}
        </p>
      )}

      <button
        type="button"
        disabled={!puede}
        onClick={eliminar}
        className="mt-5 flex items-center gap-2 border border-red-500 px-5 py-3 font-mono text-xs tracking-widest text-red-400 hover:bg-red-500/10 disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
        {busy ? "ELIMINANDO..." : "ELIMINAR PARA SIEMPRE"}
      </button>
      {previaVigente && !motivoOk && !tienePlata && !previa.esModerador && (
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">
          Falta el motivo: al menos 10 caracteres. Es lo único que va a quedar.
        </p>
      )}

      {/* ---------------- EL REGISTRO ---------------- */}
      <div className="mt-10">
        <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
          ELIMINADAS ({eliminaciones.length})
        </p>
        {eliminaciones.length === 0 ? (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Todavía no se eliminó ninguna cuenta.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border border border-border">
            {eliminaciones.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <p className="font-mono text-[11px]">
                  <span className="text-muted-foreground">#{h.id}</span> {h.email}{" "}
                  <span className="text-muted-foreground">
                    · {h.mode.toUpperCase()} · por {h.removedBy} ·{" "}
                    {new Date(h.removedAt).toLocaleString("es-CO")}
                  </span>
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{h.note}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {h.measured
                    ? `MEDIDO: ${JSON.stringify(h.measured)}`
                    : `SIN MEDICIÓN (se borró pero no se alcanzó a contar). PLAN: ${JSON.stringify(h.plan)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
