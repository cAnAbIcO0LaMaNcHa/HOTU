"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Disc3 } from "lucide-react";
import type { BranchOption, TagOption } from "@/lib/db";
import { GenrePicker, MIN_TAGS, type SeleccionGenero } from "@/components/genre-picker";

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

  // paso 2. El selector vive en GenrePicker, compartido con la edición y
  // con el alta de colectivo: tres usos, una sola copia de la regla.
  const [genero, setGenero] = useState<SeleccionGenero>({
    primary: "",
    secundarios: [],
    tags: [],
  });
  const [buscar, setBuscar] = useState("");

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

  async function crear() {
    setError(null);
    if (!genero.primary) return setError("Elegí tu género principal.");
    if (genero.tags.length < MIN_TAGS) return setError(`Elegí al menos ${MIN_TAGS} tags.`);
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
          primaryBranch: genero.primary,
          secondaryBranches: genero.secundarios,
          tags: genero.tags.map((t) => ({ slug: t.slug, branchCode: t.branchCode })),
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
        <div className="mt-5">
          <GenrePicker
            branches={branches}
            tags={tags}
            valor={genero}
            onChange={setGenero}
            buscar={buscar}
            onBuscar={setBuscar}
            disabled={busy}
          />
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
