"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eraser, EyeOff, Unlink } from "lucide-react";
import type { CuentaListada, Eliminacion, InventarioCuenta } from "@/lib/accounts-delete";

/**
 * LA LIMPIEZA PRE-LANZAMIENTO (§8).
 *
 * La única pantalla de HOTU que borra algo para siempre. Todo lo que
 * sigue está puesto para que nadie llegue al botón sin querer.
 *
 * ============================================================
 * LA VISTA PREVIA ES UNA GUARDA, NO UNA CORTESÍA
 * ============================================================
 *
 * El botón de borrar está deshabilitado hasta que haya llegado una
 * previa PARA EXACTAMENTE ESTA SELECCIÓN. Tocar una casilla la anula, y
 * hay que volver a pedirla. Es el mismo mecanismo que el traspaso, y por
 * la misma razón: "hay una previa" no significa "hay una previa de
 * esto". Alguien mira qué se lleva una lista, agrega una cuenta más, y
 * confirma sobre la foto de la anterior.
 *
 * ============================================================
 * LO QUE LA PREVIA TIENE QUE GRITAR
 * ============================================================
 *
 * Plata y perfiles. Una cuenta con pedidos o boletas sale marcada en
 * rojo con el monto, porque esa es la línea que la limpieza cruza y el
 * borrado normal no. Y si esas boletas le contaban como venta a algún
 * DJ, se listan los slugs: borrarlas le saca ventas del press kit a
 * alguien que no tiene nada que ver con la cuenta de prueba.
 */

type Inventarios = { inventarios: InventarioCuenta[]; noEncontradas: string[] };

type Resultado = {
  email: string;
  ok: boolean;
  error?: string;
  registroId?: number;
  medido?: Record<string, number>;
  registroCompleto?: boolean;
};

const cop = (n: number) => new Intl.NumberFormat("es-CO").format(n);

/** La firma de una selección, para saber si la previa sigue siendo de ella. */
const firmaDe = (sel: Set<string>) => [...sel].sort().join("|");

export function PanelLimpieza({
  cuentas,
  hechas,
}: {
  cuentas: CuentaListada[];
  hechas: Eliminacion[];
}) {
  const router = useRouter();

  const [secret, setSecret] = useState("");
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState<"desamparar" | "ocultar">("desamparar");
  const [sel, setSel] = useState<Set<string>>(new Set());

  const [previa, setPrevia] = useState<Inventarios | null>(null);
  /** De QUÉ selección es la previa que está en pantalla. */
  const [previaDe, setPreviaDe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);

  const firma = firmaDe(sel);
  const previaVigente = previa !== null && previaDe === firma && sel.size > 0;
  const motivoOk = motivo.trim().length >= 10;

  const alternar = (email: string) => {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(email)) n.delete(email);
      else n.add(email);
      return n;
    });
    // Cambió la selección: la previa que había ya no es de esto.
    setPrevia(null);
    setPreviaDe(null);
    setResultados(null);
  };

  const llamar = async (accion: "vista-previa" | "eliminar") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          accion,
          emails: [...sel],
          motivo,
          destinoPerfiles: destino,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error ?? `Error ${res.status}`);
        return null;
      }
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const verPrevia = async () => {
    const j = await llamar("vista-previa");
    if (!j) return;
    setPrevia({ inventarios: j.inventarios ?? [], noEncontradas: j.noEncontradas ?? [] });
    setPreviaDe(firma);
    setResultados(null);
  };

  const borrar = async () => {
    const j = await llamar("eliminar");
    if (!j) return;
    setResultados(j.resultados ?? []);
    setPrevia(null);
    setPreviaDe(null);
    setSel(new Set());
    router.refresh();
  };

  const conPlata = (previa?.inventarios ?? []).filter((i) => i.pedidos > 0 || i.boletas > 0);
  const totalCop = (previa?.inventarios ?? []).reduce((t, i) => t + i.montoCop, 0);

  return (
    <div className="mt-10 space-y-12">
      {/* ================= LA ADVERTENCIA ================= */}
      <div className="border border-red-500/60 bg-red-500/5 p-5">
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] text-red-400">
          <AlertTriangle className="h-4 w-4" /> ESTO NO SE DESHACE
        </p>
        <p className="mt-3 max-w-3xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          Es lo único en HOTU que borra de verdad. Se van la cuenta, sus likes, sus
          roles y —solo acá— sus pedidos y boletas. Lo que se queda son los perfiles,
          los eventos y las noticias: pierden el dueño, no la existencia.
        </p>
        <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          Si la cuenta es de una persona real, lo que corresponde es <strong>banearla</strong>:
          se deshace y no borra nada. Esta pantalla existe para sacar las cuentas de
          prueba antes de abrir al público, y se apaga sola cuando se saca
          LIMPIEZA_PRELANZAMIENTO del entorno.
        </p>
      </div>

      {/* ================= LAS CUENTAS ================= */}
      <section>
        <h2 className="font-mono text-xs tracking-[0.3em] text-primary">
          / ELEGÍ LAS CUENTAS, UNA POR UNA
        </h2>
        <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          No hay ningún filtro de &quot;las de prueba&quot;. Un patrón que parece decir eso es
          la forma más común de borrar de más.
        </p>

        <div className="mt-5 divide-y divide-border border border-border">
          {cuentas.map((c) => {
            const elegida = sel.has(c.email);
            const bloqueada = c.esModerador;
            return (
              <label
                key={c.email}
                className={`flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 ${
                  bloqueada ? "cursor-not-allowed opacity-50" : "hover:bg-card/50"
                } ${elegida ? "bg-red-500/5" : ""}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-red-500"
                  checked={elegida}
                  disabled={bloqueada || busy}
                  onChange={() => alternar(c.email)}
                />
                <span className="font-mono text-xs">{c.email}</span>
                {c.displayName && (
                  <span className="font-mono text-[10px] text-muted-foreground">{c.displayName}</span>
                )}
                <span className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground">
                  {bloqueada && <span className="text-amber-400">MODERA · NO SE PUEDE</span>}
                  {c.fantasma && <span className="text-muted-foreground">FANTASMA</span>}
                  {c.baneada && <span className="text-amber-400">BANEADA</span>}
                  {c.authProvider && <span>{c.authProvider.toUpperCase()}</span>}
                  {c.perfiles > 0 && <span>{c.perfiles} PERFIL(ES)</span>}
                  {c.likes > 0 && <span>{c.likes} LIKES</span>}
                  {(c.pedidos > 0 || c.boletas > 0) && (
                    <span className="text-red-400">
                      {c.pedidos} PEDIDOS · {c.boletas} BOLETAS
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          {cuentas.length === 0 && (
            <p className="px-4 py-6 font-mono text-[11px] text-muted-foreground">
              No hay cuentas.
            </p>
          )}
        </div>
      </section>

      {/* ================= LOS PARÁMETROS ================= */}
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
            MOTIVO (MÍNIMO 10 CARACTERES)
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Limpieza pre-lanzamiento: cuentas de prueba de la tanda 1"
            className="mt-2 w-full border border-border bg-transparent px-3 py-2 font-mono text-xs"
          />
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Queda en el registro. Es lo único que va a quedar: la persona ya no está
            para preguntarle.
          </p>
        </div>

        <div>
          <label className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
            CLAVE DE MIGRACIÓN
          </label>
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="MIGRATE_SECRET"
            className="mt-2 w-full border border-border bg-transparent px-3 py-2 font-mono text-xs"
          />
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            La segunda llave. No viaja en la cookie, así que tu sesión sola no alcanza.
          </p>
        </div>
      </section>

      {/* ================= QUÉ PASA CON LOS PERFILES ================= */}
      <section>
        <h2 className="font-mono text-xs tracking-[0.3em] text-primary">
          / Y LOS PERFILES QUE ADMINISTRABA
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setDestino("desamparar")}
            className={`border p-4 text-left ${
              destino === "desamparar" ? "border-primary" : "border-border hover:border-primary/50"
            }`}
          >
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em]">
              <Unlink className="h-4 w-4" /> DEJARLOS DESAMPARADOS
            </span>
            <span className="mt-2 block font-mono text-[10px] leading-relaxed text-muted-foreground">
              Siguen publicados y visibles, sin dueño. Cualquiera los puede reclamar
              después. Es lo que pasa solo: el schema los desengancha.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDestino("ocultar")}
            className={`border p-4 text-left ${
              destino === "ocultar" ? "border-primary" : "border-border hover:border-primary/50"
            }`}
          >
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em]">
              <EyeOff className="h-4 w-4" /> OCULTARLOS
            </span>
            <span className="mt-2 block font-mono text-[10px] leading-relaxed text-muted-foreground">
              Se censuran con el motivo de arriba, junto con sus sets y tracks. No se
              borran: un moderador puede levantar la censura. Los eventos y noticias del
              colectivo NO se tocan, porque hay gente con boletas compradas.
            </span>
          </button>
        </div>
      </section>

      {error && (
        <p className="border border-red-500/50 bg-red-500/5 px-4 py-3 font-mono text-[11px] text-red-400">
          {error}
        </p>
      )}

      {/* ================= LA VISTA PREVIA ================= */}
      <section>
        <button
          type="button"
          disabled={busy || sel.size === 0 || !secret}
          onClick={verPrevia}
          className="border border-border px-5 py-3 font-mono text-xs tracking-widest hover:border-primary disabled:opacity-40"
        >
          {busy ? "MIRANDO..." : `VER QUÉ SE LLEVA (${sel.size})`}
        </button>

        {previaVigente && previa && (
          <div className="mt-6 space-y-4">
            {previa.noEncontradas.length > 0 && (
              <p className="border border-amber-500/50 bg-amber-500/5 px-4 py-3 font-mono text-[11px] text-amber-400">
                No existen: {previa.noEncontradas.join(", ")}
              </p>
            )}

            {conPlata.length > 0 && (
              <div className="border border-red-500/60 bg-red-500/5 p-4">
                <p className="font-mono text-[11px] tracking-[0.2em] text-red-400">
                  HAY PLATA DE POR MEDIO: {conPlata.length} CUENTA(S), ${cop(totalCop)} COP
                </p>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  Esta es la línea que solo la limpieza cruza. Mirá una por una y
                  confirmá que ninguna es de una persona real.
                </p>
              </div>
            )}

            {previa.inventarios.map((i) => (
              <div key={i.email} className="border border-border p-4">
                <p className="font-mono text-xs">{i.email}</p>
                <ul className="mt-3 space-y-1 font-mono text-[10px] text-muted-foreground">
                  <li>
                    SE BORRA: {i.likes} like(s), {i.roles.length} rol(es)
                    {i.roles.length > 0 && ` (${i.roles.join(", ")})`}
                  </li>
                  {(i.pedidos > 0 || i.boletas > 0) && (
                    <li className="text-red-400">
                      SE BORRA TAMBIÉN: {i.pedidos} pedido(s) por ${cop(i.montoCop)} COP,{" "}
                      {i.boletas} boleta(s), {i.itemsDePedido} ítem(s), {i.atribuciones}{" "}
                      atribución(es)
                      {i.vendedores.length > 0 && (
                        <>
                          {" "}
                          — esas ventas le contaban a: {i.vendedores.join(", ")}
                        </>
                      )}
                    </li>
                  )}
                  <li>
                    {destino === "ocultar" ? "SE OCULTA" : "QUEDA SIN DUEÑO"}:{" "}
                    {i.artistas.length} artista(s)
                    {i.artistas.length > 0 && ` (${i.artistas.map((a) => a.slug).join(", ")})`},{" "}
                    {i.colectivos.length} colectivo(s)
                    {i.colectivos.length > 0 &&
                      ` (${i.colectivos.map((c) => c.slug).join(", ")})`}
                    {destino === "ocultar" && i.setsYTracks > 0 && `, ${i.setsYTracks} set(s)/track(s)`}
                  </li>
                  {i.marcasDeModeracion > 0 && (
                    <li>
                      QUEDAN SIN FIRMA: {i.marcasDeModeracion} marca(s) de moderación suya(s)
                    </li>
                  )}
                  {i.cesionesAbiertas > 0 && (
                    <li>SE REVOCAN: {i.cesionesAbiertas} cesión(es) abierta(s)</li>
                  )}
                  {i.baneada && <li className="text-amber-400">ESTÁ BANEADA</li>}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ================= EL BOTÓN ================= */}
      <section className="border-t border-border pt-8">
        <button
          type="button"
          disabled={busy || !previaVigente || !motivoOk || !secret}
          onClick={borrar}
          className="flex items-center gap-2 border border-red-500 px-5 py-3 font-mono text-xs tracking-widest text-red-400 hover:bg-red-500/10 disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" />
          {busy ? "BORRANDO..." : `BORRAR DEFINITIVAMENTE (${sel.size})`}
        </button>
        {!previaVigente && sel.size > 0 && (
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            Pedí la vista previa de esta selección antes de confirmar.
          </p>
        )}
        {previaVigente && !motivoOk && (
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            Falta el motivo: al menos 10 caracteres.
          </p>
        )}
      </section>

      {/* ================= EL RESULTADO ================= */}
      {resultados && (
        <section className="border border-border p-4">
          <h2 className="font-mono text-xs tracking-[0.3em] text-primary">/ QUÉ PASÓ</h2>
          <ul className="mt-3 space-y-2 font-mono text-[10px]">
            {resultados.map((r) => (
              <li key={r.email} className={r.ok ? "text-muted-foreground" : "text-red-400"}>
                {r.ok ? "BORRADA" : "NO SE PUDO"} · {r.email}
                {r.ok && r.medido && (
                  <>
                    {" "}
                    · registro #{r.registroId} ·{" "}
                    {Object.entries(r.medido)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => `${k}: ${n}`)
                      .join(", ") || "sin nada más que la cuenta"}
                  </>
                )}
                {r.ok && r.registroCompleto === false && (
                  <span className="text-amber-400">
                    {" "}
                    · OJO: el registro quedó sin el conteo (measured en NULL)
                  </span>
                )}
                {!r.ok && ` · ${r.error}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ================= LO QUE YA SE BORRÓ ================= */}
      <section>
        <h2 className="font-mono text-xs tracking-[0.3em] text-primary">/ REGISTRO</h2>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Permanente. Sobrevive a las cuentas que registra, porque no las referencia.
        </p>
        {hechas.length === 0 ? (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            Todavía no se eliminó ninguna cuenta.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border border border-border">
            {hechas.map((h) => (
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
      </section>
    </div>
  );
}
