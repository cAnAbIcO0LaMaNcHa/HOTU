"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Disc3, Search, X } from "lucide-react";
import type { BranchOption, TagOption } from "@/lib/db";
import { normalize } from "@/components/listing-filters";

/**
 * CREAR MI PERFIL DE DJ (ALTA-DJ paso 3).
 *
 * Dos pasos y UNA sola escritura, al final. Nada se manda hasta que los
 * dos están completos, así que un alta abandonada a mitad no deja fila,
 * ni slug ocupado, ni código reservado.
 *
 * El paso 1 es identidad y el 2 es género. Ese orden no es estético: los
 * 719 tags solo son navegables después de elegir una rama, que reduce la
 * lista a unos 20.
 */
export function CrearArtista({
  branches,
  tags,
}: {
  branches: BranchOption[];
  tags: TagOption[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // paso 1
  const [name, setName] = useState("");
  const [djCode, setDjCode] = useState("");
  const [city, setCity] = useState("Bogotá");
  const [origin, setOrigin] = useState("");
  const [slug, setSlug] = useState("");
  const [codeLibre, setCodeLibre] = useState<boolean | null>(null);

  // paso 2
  const [primary, setPrimary] = useState("");
  const [secundarios, setSecundarios] = useState<string[]>([]);
  const [elegidos, setElegidos] = useState<TagOption[]>([]);
  const [buscar, setBuscar] = useState("");

  const nombreDeRama = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.code, b.name])),
    [branches]
  );

  /**
   * Los tags que se ofrecen.
   *
   * Sin búsqueda, los de la rama elegida, que es el caso normal. Con
   * búsqueda, LOS 719, porque un tag transversal vive en varias ramas y
   * encerrar el buscador en la propia sería justamente impedir el caso
   * que la clave compuesta existe para permitir.
   */
  const sugeridos = useMemo(() => {
    const q = normalize(buscar);
    const base = q
      ? tags.filter((t) => normalize(t.name).includes(q) || normalize(t.slug).includes(q))
      : tags.filter((t) => t.branchCode === primary);
    const ya = new Set(elegidos.map((t) => t.slug));
    return base.filter((t) => !ya.has(t.slug)).slice(0, 60);
  }, [buscar, tags, primary, elegidos]);

  async function consultar(nombre: string, code: string) {
    const p = new URLSearchParams();
    if (nombre) p.set("name", nombre);
    if (code) p.set("djCode", code);
    if (!p.toString()) return;
    try {
      const res = await fetch(`/api/artists?${p}`);
      if (!res.ok) return;
      const d = await res.json();
      if (typeof d.slug === "string") setSlug(d.slug);
      if (typeof d.djCodeSugerido === "string" && !code && !djCode) setDjCode(d.djCodeSugerido);
      if (typeof d.djCodeLibre === "boolean") setCodeLibre(d.djCodeLibre);
    } catch {
      // Es una ayuda, no una validación: si falla, el servidor decide al
      // enviar. No hay nada que mostrarle al usuario acá.
    }
  }

  function alPaso2() {
    setError(null);
    if (name.trim().length < 2) return setError("Poné tu nombre artístico.");
    if (!/^[A-Za-z]{3,12}$/.test(djCode.trim()))
      return setError("El código tiene que ser de 3 a 12 letras, sin números ni guiones.");
    if (codeLibre === false) return setError(`El código ${djCode.toUpperCase()} ya está tomado.`);
    if (city.trim().length < 2) return setError("Poné la ciudad donde vivís.");
    setPaso(2);
  }

  function toggleTag(t: TagOption) {
    setElegidos((prev) =>
      prev.some((x) => x.slug === t.slug)
        ? prev.filter((x) => x.slug !== t.slug)
        : prev.length >= 8
          ? prev
          : [...prev, t]
    );
  }

  function toggleSecundario(code: string) {
    setSecundarios((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : prev.length >= 3
          ? prev
          : [...prev, code]
    );
  }

  async function crear() {
    setError(null);
    if (!primary) return setError("Elegí tu género principal.");
    if (elegidos.length < 3) return setError("Elegí al menos 3 tags.");
    setBusy(true);
    try {
      const res = await fetch("/api/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          djCode,
          city,
          origin,
          primaryBranch: primary,
          secondaryBranches: secundarios,
          tags: elegidos.map((t) => ({ slug: t.slug, branchCode: t.branchCode })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `No se pudo crear (HTTP ${res.status})`);
        // Si el conflicto fue del código o del slug, hay que volver al
        // paso donde eso se arregla.
        if (res.status === 409) setPaso(1);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo crear. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (!abierto) {
    return (
      <div className="mt-10">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="inline-flex items-center gap-2 border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/80 hover:border-primary hover:text-primary"
        >
          <Disc3 className="h-3 w-3" /> CREAR MI PERFIL DE DJ
        </button>
      </div>
    );
  }

  return (
    <div className="border-chrome mt-10 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold">CREAR MI PERFIL DE DJ</h2>
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          PASO {paso} DE 2
        </span>
      </div>

      {paso === 1 ? (
        <div className="mt-5 flex flex-col gap-4">
          <Campo
            label="NOMBRE ARTÍSTICO"
            value={name}
            onChange={(v) => {
              setName(v);
              setCodeLibre(null);
            }}
            onBlur={() => consultar(name, "")}
            placeholder="Como te anuncian en un flyer"
            disabled={busy}
          />
          {slug && (
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              Tu perfil va a vivir en <strong className="text-foreground">/artistas/{slug}</strong>.
              No se puede cambiar después: es la dirección que vas a compartir.
            </p>
          )}

          <Campo
            label="TU CÓDIGO DE DJ"
            value={djCode}
            onChange={(v) => {
              setDjCode(v.toUpperCase().replace(/[^A-Za-z]/g, ""));
              setCodeLibre(null);
            }}
            onBlur={() => consultar("", djCode)}
            placeholder="CAMILA"
            disabled={busy}
            hint="De 3 a 12 letras, sin números ni guiones. Es lo que alguien dicta en la puerta para que la venta cuente como tuya, así que tiene que ser fácil de decir en voz alta."
          />
          {codeLibre === true && (
            <p className="font-mono text-[10px] text-primary">
              {djCode.toUpperCase()} está libre.
            </p>
          )}
          {codeLibre === false && (
            <p className="font-mono text-[10px] text-primary">
              {djCode.toUpperCase()} ya está tomado. Probá con otro.
            </p>
          )}

          <Campo
            label="CIUDAD DONDE VIVÍS"
            value={city}
            onChange={setCity}
            disabled={busy}
          />
          <Campo
            label="DE DÓNDE SOS (OPCIONAL)"
            value={origin}
            onChange={setOrigin}
            placeholder="Si no es la misma"
            disabled={busy}
          />
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          <div>
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              TU GÉNERO PRINCIPAL
            </span>
            <select
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              disabled={busy}
              className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Elegí uno</option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} · {b.category}
                </option>
              ))}
            </select>
          </div>

          {primary && (
            <div>
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                SECUNDARIOS (HASTA 3, OPCIONAL)
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {branches
                  .filter((b) => b.code !== primary)
                  .map((b) => {
                    const on = secundarios.includes(b.code);
                    return (
                      <button
                        key={b.code}
                        type="button"
                        onClick={() => toggleSecundario(b.code)}
                        disabled={busy || (!on && secundarios.length >= 3)}
                        className={`border px-2 py-1 font-mono text-[10px] tracking-widest disabled:opacity-30 ${
                          on ? "border-primary text-primary" : "border-border hover:border-primary"
                        }`}
                      >
                        {b.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {primary && (
            <div>
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                TUS TAGS ({elegidos.length} DE 3 A 8)
              </span>
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Los tres primeros son los principales. Buscá para encontrar tags de
                cualquier rama, no solo de la tuya: muchos viven en varias.
              </p>

              {elegidos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {elegidos.map((t, i) => (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => toggleTag(t)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 border border-primary px-2 py-1 font-mono text-[10px] tracking-widest text-primary"
                    >
                      {i < 3 && <span className="text-[8px]">★</span>}
                      {t.name}
                      {t.branchCode !== primary && (
                        <span className="text-muted-foreground">·{t.branchCode}</span>
                      )}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                  placeholder="Buscar en los 719 tags..."
                  disabled={busy}
                  className="w-full border border-border bg-background py-2 pl-9 pr-3 font-mono text-xs focus:border-primary focus:outline-none"
                />
              </div>

              <div className="mt-3 flex max-h-64 flex-wrap gap-2 overflow-y-auto">
                {sugeridos.map((t) => (
                  <button
                    key={`${t.slug}-${t.branchCode}`}
                    type="button"
                    onClick={() => toggleTag(t)}
                    disabled={busy || elegidos.length >= 8}
                    className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest hover:border-primary hover:text-primary disabled:opacity-30"
                  >
                    {t.name}
                    {t.branchCode !== primary && (
                      <span className="ml-1 text-muted-foreground">·{nombreDeRama[t.branchCode]}</span>
                    )}
                  </button>
                ))}
                {sugeridos.length === 0 && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {buscar ? "Nada coincide." : "Elegí un género principal."}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {paso === 1 ? (
          <button
            type="button"
            onClick={alPaso2}
            disabled={busy}
            className="surface-chrome sheen px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-50"
          >
            SIGUIENTE
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={crear}
              disabled={busy}
              className="surface-chrome sheen px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em] disabled:opacity-50"
            >
              {busy ? "CREANDO..." : "CREAR MI PERFIL"}
            </button>
            <button
              type="button"
              onClick={() => setPaso(1)}
              disabled={busy}
              className="border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-foreground/70 hover:border-primary disabled:opacity-50"
            >
              VOLVER
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setPaso(1);
            setError(null);
          }}
          disabled={busy}
          className="border border-border px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-muted-foreground hover:border-primary disabled:opacity-50"
        >
          CANCELAR
        </button>
      </div>

      <p className="mt-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Nada se guarda hasta que toques CREAR MI PERFIL. Después nace como borrador:
        lo llenás tranquilo y lo mandás a revisión cuando esté listo.
      </p>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="mt-1 w-full border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
      />
      {hint && (
        <span className="mt-1 block font-mono text-[10px] leading-relaxed text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
