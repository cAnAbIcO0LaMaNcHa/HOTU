"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRightLeft, EyeOff, RotateCcw, UserX } from "lucide-react";
import type { CuentaBaneada, PiezaCensurada } from "@/lib/db";

const TIPOS: Array<{ id: PiezaCensurada["tipo"]; label: string; donde: string; clave: string }> = [
  { id: "artist", label: "PERFIL DE DJ", donde: "/artistas", clave: "slug" },
  { id: "collective", label: "COLECTIVO", donde: "/colectivos", clave: "slug" },
  { id: "event", label: "EVENTO", donde: "/eventos", clave: "id" },
  { id: "news", label: "NOTICIA", donde: "/noticias", clave: "id" },
  { id: "set", label: "SET", donde: "/sets", clave: "slug" },
  { id: "track", label: "TRACK", donde: "/discografia", clave: "slug" },
];

/**
 * CENSURAR y BANEAR, las dos acciones que le quedan al admin además de
 * las colas (tanda 5 §4).
 *
 * ============================================================
 * LAS DOS PIDEN MOTIVO, Y EL BOTÓN NO SE HABILITA SIN ÉL
 * ============================================================
 *
 * El motivo es lo único que recibe la persona del otro lado. Contenido
 * que desaparece sin explicación es por donde la gente se va de una
 * plataforma, y una cuenta cerrada sin razón no se puede ni discutir.
 *
 * La base lo exige con un CHECK y el lib lo valida; esta es la tercera
 * guarda y la única que se ve antes del click.
 *
 * ============================================================
 * LO CENSURADO Y LO BANEADO SE LISTAN, SIEMPRE
 * ============================================================
 *
 * Una decisión de moderación que no se puede revisar después es una
 * decisión que nadie audita. Las dos listas muestran qué, quién y por
 * qué, y las dos se deshacen con un click.
 */
export function PanelModeracion({
  censuradas,
  baneadas,
}: {
  censuradas: PiezaCensurada[];
  baneadas: CuentaBaneada[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [tipo, setTipo] = useState<PiezaCensurada["tipo"]>("news");
  const [clave, setClave] = useState("");
  const [motivo, setMotivo] = useState("");

  const [email, setEmail] = useState("");
  const [motivoBan, setMotivoBan] = useState("");

  // El traspaso de un perfil a su dueño de verdad.
  const [tTipo, setTTipo] = useState<"artist" | "collective">("artist");
  const [tSlug, setTSlug] = useState("");
  const [tEmail, setTEmail] = useState("");
  const [tMotivo, setTMotivo] = useState("");
  const [tPreview, setTPreview] = useState<{
    dueno: string | null;
    administra: { artistas: Array<{ slug: string; name: string }>; colectivos: Array<{ slug: string; name: string; esVenue: boolean }> };
  } | null>(null);
  /**
   * PARA QUÉ perfil es la vista previa que hay en pantalla.
   *
   * Sin esto, "hay una previa" no significa "hay una previa DE ESTO":
   * alguien mira lo que mueve un slug, cambia el slug, y confirma sobre
   * la foto del anterior.
   */
  const [tPreviewDe, setTPreviewDe] = useState<string>("");
  const [tBuscando, setTBuscando] = useState(false);

  /**
   * LA VISTA PREVIA SE PIDE MIENTRAS SE ESCRIBE, NO AL SALIR DEL CAMPO.
   *
   * Antes iba en el onBlur, y el fetch es asíncrono: clickear ENTREGAR
   * dispara el blur, pero la respuesta podía llegar DESPUÉS de que el
   * traspaso ya había salido. Una previa que llega tarde no es una
   * previa, y una que se puede saltear no sirve para lo único que hace:
   * evitar que alguien confirme algo que mueve más de lo que creía.
   *
   * El efecto se cancela a sí mismo al cambiar el slug, así que una
   * respuesta vieja que llegue tarde no pisa a una nueva.
   */
  useEffect(() => {
    const slug = tSlug.trim();
    setTPreview(null);
    setTPreviewDe("");
    if (!slug) return;

    let vigente = true;
    setTBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/moderation/owner?tipo=${tTipo}&slug=${encodeURIComponent(slug)}`
        );
        const d = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (res.ok) {
          setTPreview(d);
          setTPreviewDe(slug);
        }
      } finally {
        if (vigente) setTBuscando(false);
      }
    }, 350);

    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [tTipo, tSlug]);

  const elTipo = TIPOS.find((t) => t.id === tipo)!;

  async function pedir(ruta: string, body: unknown, exito: string) {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch(ruta, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo (HTTP ${res.status})`);
        return null;
      }
      setAviso(exito);
      router.refresh();
      return d;
    } catch {
      setError("No se pudo. Revisá la conexión.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const CONTENIDO = "/api/admin/moderation/content";
  const CUENTAS = "/api/admin/moderation/accounts";

  return (
    <div className="mt-8 space-y-14">
      {error && (
        <p role="alert" className="font-mono text-[11px] text-red-400">
          {error}
        </p>
      )}
      {aviso && <p className="font-mono text-[11px] text-primary">{aviso}</p>}

      {/* ---------------- CENSURAR ---------------- */}
      <section>
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <EyeOff className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
            BAJAR UNA PIEZA DEL SITIO
          </h2>
        </div>
        <p className="mt-3 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          Desaparece del sitio al instante. Su autor la sigue viendo, marcada y con
          el motivo, y NO la puede volver a publicar — solo vos la podés devolver. No
          se borra nada.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              QUÉ
            </span>
            <select
              value={tipo}
              disabled={busy}
              onChange={(e) => setTipo(e.target.value as PiezaCensurada["tipo"])}
              className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            >
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              {elTipo.clave === "id" ? "ID (el número de la URL)" : "SLUG (el de la URL)"}
            </span>
            <input
              value={clave}
              disabled={busy}
              onChange={(e) => setClave(e.target.value)}
              placeholder={elTipo.clave === "id" ? "42" : "nombre-en-la-url"}
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
            <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
              Sale de {elTipo.donde}/…
            </span>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            MOTIVO — lo lee el autor
          </span>
          <textarea
            value={motivo}
            rows={2}
            disabled={busy}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Qué regla rompe, en una línea que se entienda"
            className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-primary"
          />
        </label>

        <button
          type="button"
          disabled={busy || motivo.trim().length < 10 || clave.trim() === ""}
          onClick={async () => {
            const r = await pedir(
              CONTENIDO,
              { tipo, clave: clave.trim(), accion: "censurar", motivo },
              "Bajada del sitio."
            );
            if (r) {
              setClave("");
              setMotivo("");
            }
          }}
          className="mt-5 border border-red-400/50 px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em] text-red-400 hover:border-red-400 disabled:opacity-40"
        >
          {busy ? "..." : "CENSURAR"}
        </button>
        {motivo.trim().length < 10 && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            El motivo tiene que explicar qué pasó: al menos 10 caracteres.
          </p>
        )}

        {censuradas.length > 0 && (
          <div className="mt-8">
            <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              CENSURADO AHORA MISMO ({censuradas.length})
            </p>
            <div className="mt-3 space-y-2">
              {censuradas.map((c) => (
                <div
                  key={`${c.tipo}:${c.clave}`}
                  className="flex flex-wrap items-start justify-between gap-3 border border-border p-4"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                      {TIPOS.find((t) => t.id === c.tipo)?.label ?? c.tipo.toUpperCase()} ·{" "}
                      {c.clave}
                    </div>
                    <div className="mt-1 font-bold">{c.titulo}</div>
                    <blockquote className="mt-2 border-l-2 border-border pl-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {c.motivo}
                    </blockquote>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {new Date(c.censuradaEn).toLocaleDateString("es-CO")}
                      {c.censuradaPor ? ` · ${c.censuradaPor}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      pedir(
                        CONTENIDO,
                        { tipo: c.tipo, clave: c.clave, accion: "levantar" },
                        "Devuelta al sitio."
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> DEVOLVER
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---------------- BANEAR ---------------- */}
      <section>
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <UserX className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
            CERRAR UNA CUENTA
          </h2>
        </div>
        <p className="mt-3 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          Se cierra la CUENTA, no el perfil: no puede volver a entrar por ninguna vía.
          Su perfil de DJ, sus sets y sus tracks dejan de verse; nada se borra y todo
          vuelve si levantás el ban.
        </p>
        <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          Si era dueña de un colectivo o un venue, <strong>ese colectivo queda sin
          dueño pero sigue en pie y sus miembros se quedan</strong>: hay gente que no
          hizo nada y gente con boletas compradas. Lo puntual que esté mal se censura
          arriba, de a uno.
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
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              MOTIVO
            </span>
            <input
              value={motivoBan}
              disabled={busy}
              onChange={(e) => setMotivoBan(e.target.value)}
              placeholder="Qué hizo"
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
          </label>
        </div>

        <button
          type="button"
          disabled={busy || motivoBan.trim().length < 10 || email.trim() === ""}
          onClick={async () => {
            const r = await pedir(
              CUENTAS,
              { email: email.trim(), accion: "banear", motivo: motivoBan },
              "Cuenta cerrada."
            );
            if (r) {
              const sueltos: string[] = r.colectivosSinDueno ?? [];
              setAviso(
                sueltos.length > 0
                  ? `Cuenta cerrada. Quedaron sin dueño: ${sueltos.join(", ")}. Sus miembros siguen adentro.`
                  : "Cuenta cerrada."
              );
              setEmail("");
              setMotivoBan("");
            }
          }}
          className="mt-5 border border-red-400/50 px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em] text-red-400 hover:border-red-400 disabled:opacity-40"
        >
          {busy ? "..." : "BANEAR"}
        </button>

        {baneadas.length > 0 && (
          <div className="mt-8">
            <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              CUENTAS CERRADAS ({baneadas.length})
            </p>
            <div className="mt-3 space-y-2">
              {baneadas.map((b) => (
                <div
                  key={b.email}
                  className="flex flex-wrap items-start justify-between gap-3 border border-border p-4"
                >
                  <div className="min-w-0">
                    <div className="font-bold">{b.nombre ?? b.email}</div>
                    <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                      {b.email}
                    </div>
                    <blockquote className="mt-2 border-l-2 border-border pl-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {b.motivo}
                    </blockquote>
                    {b.artistas.length > 0 && (
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                        ESCONDE: {b.artistas.join(", ")}
                      </div>
                    )}
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {new Date(b.baneadaEn).toLocaleDateString("es-CO")}
                      {b.baneadaPor ? ` · ${b.baneadaPor}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      pedir(
                        CUENTAS,
                        { email: b.email, accion: "levantar" },
                        "Cuenta reabierta. El colectivo que perdió NO se devuelve solo."
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> REABRIR
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---------------- TRASPASAR UN PERFIL ---------------- */}
      <section>
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <ArrowRightLeft className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-primary">
            ENTREGARLE UN PERFIL A SU DUEÑO
          </h2>
        </div>
        <p className="mt-3 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          Para los perfiles que nacieron sin dueño y quedaron a nombre de una cuenta
          en la que nadie puede entrar. Cuando la persona aparece y te demuestra que
          es suyo, esto se lo entrega.
        </p>
        <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-primary">Esto no verifica nada: lo verificás vos.</strong>{" "}
          HOTU no tiene forma de contactar a nadie —no hay correo saliente, y los
          perfiles no tienen redes ni mail de contacto cargados—, así que la prueba
          la conseguís por fuera y acá queda escrito CÓMO. Eso es lo que alguien va a
          leer dentro de seis meses.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              QUÉ PERFIL
            </span>
            <select
              value={tTipo}
              disabled={busy}
              onChange={(e) => setTTipo(e.target.value as "artist" | "collective")}
              className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            >
              <option value="artist">PERFIL DE DJ</option>
              <option value="collective">COLECTIVO O VENUE</option>
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              SLUG (el de la URL)
            </span>
            <input
              value={tSlug}
              disabled={busy}
              onChange={(e) => setTSlug(e.target.value)}
              placeholder="nombre-en-la-url"
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
          </label>
        </div>

        {/*
          QUÉ SE VA A LLEVAR, ANTES DE APRETAR.

          El traspaso mueve TODO lo que administra esa cuenta, no el
          perfil suelto: siete de las cuentas fantasma tienen un artista
          y un colectivo, y mover solo uno deja el otro a nombre de una
          cuenta muerta. Un botón que mueve más de lo que dice es un
          botón que se aprieta una sola vez.
        */}
        {tPreview && (
          <div className="mt-4 border border-border p-4">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
              {tPreview.dueno ? `HOY ES DE ${tPreview.dueno}` : "HOY NO ES DE NADIE"}
            </div>
            <div className="mt-2 font-mono text-[11px] leading-relaxed">
              SE VA A MOVER:
              <ul className="mt-1 list-inside list-disc">
                {tPreview.administra.artistas.map((a) => (
                  <li key={`a:${a.slug}`}>{a.name} — perfil de DJ</li>
                ))}
                {tPreview.administra.colectivos.map((c) => (
                  <li key={`c:${c.slug}`}>
                    {c.name} — {c.esVenue ? "venue" : "colectivo"}
                  </li>
                ))}
                {tPreview.administra.artistas.length === 0 &&
                  tPreview.administra.colectivos.length === 0 && <li>solo este perfil</li>}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              A QUÉ CUENTA (tiene que existir ya)
            </span>
            <input
              value={tEmail}
              disabled={busy}
              onChange={(e) => setTEmail(e.target.value)}
              placeholder="su-email-real@ejemplo.com"
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
            <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
              Si todavía no se registró, pedíselo: registrarse es lo único que prueba
              que controla ese correo.
            </span>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              CÓMO LO VERIFICASTE
            </span>
            <textarea
              value={tMotivo}
              rows={3}
              disabled={busy}
              onChange={(e) => setTMotivo(e.target.value)}
              placeholder="Me escribió por el Instagram de HOTU y mandó una foto del set"
              className="mt-1 w-full border border-border bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-primary"
            />
          </label>
        </div>

        <button
          type="button"
          disabled={
            busy ||
            tMotivo.trim().length < 10 ||
            tEmail.trim() === "" ||
            // La guarda de verdad: sin una previa de ESTE perfil, no hay
            // botón. Es lo que convierte "te mostramos qué se mueve" en
            // una garantía y no en una intención.
            tPreviewDe === "" ||
            tPreviewDe !== tSlug.trim()
          }
          onClick={async () => {
            const r = await pedir(
              "/api/admin/moderation/owner",
              { tipo: tTipo, slug: tSlug.trim(), email: tEmail.trim(), motivo: tMotivo },
              "Entregado."
            );
            if (r) {
              const m = r.movidos ?? { artistas: [], colectivos: [] };
              const cuantos = m.artistas.length + m.colectivos.length;
              setAviso(
                `Entregado a ${r.hacia}: ${cuantos} perfil(es).` +
                  (r.cuentaBorrada ? " La cuenta vieja quedó vacía y se borró." : "")
              );
              setTSlug("");
              setTEmail("");
              setTMotivo("");
              setTPreview(null);
            }
          }}
          className="surface-chrome sheen mt-5 px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-40"
        >
          {busy ? "..." : "ENTREGAR"}
        </button>
        {tSlug.trim() !== "" && tPreviewDe !== tSlug.trim() && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            {tBuscando
              ? "Buscando ese perfil..."
              : "No encontré ese perfil. El botón se habilita cuando aparezca acá arriba qué se va a mover."}
          </p>
        )}
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Si la cuenta vieja era una de las que se crearon sin contraseña y no le
          queda nada, se borra sola: un email deducible de la URL y sin dueño es una
          puerta esperando a que alguien abra un flujo de recuperación.
        </p>
      </section>

      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        ¿Buscás quitarle a alguien el rol de moderador? Eso es de un SUPER_ADMIN y
        está en <Link href="/admin/roles" className="text-primary hover:underline">ROLES</Link>.
        Un moderador no puede banear a otro moderador.
      </p>
    </div>
  );
}
