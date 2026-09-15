"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * El formulario de registro.
 *
 * Client component que habla con /api/accounts, no un Server Action: la
 * regla del repo es que toda escritura pasa por una ruta de API, porque
 * la app móvil va a usar los mismos endpoints y un Server Action solo lo
 * puede invocar el front de Next.
 *
 * Al terminar NO inicia sesión. La pantalla de éxito dice lo mismo
 * exista o no la cuenta, y manda a ingresar. Es incómodo a propósito:
 * entrar solo cuando la cuenta es nueva le diría a cualquiera qué
 * correos están registrados.
 */
export function RegistroForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Esta sí se chequea acá: no involucra a la base ni dice nada sobre
    // si la cuenta existe, y el servidor la vuelve a mirar igual.
    if (password !== password2) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, birthDate, consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo crear la cuenta (HTTP ${res.status})`);
        return;
      }
      setListo(true);
    } catch {
      setError("No se pudo crear la cuenta. Revisá la conexión.");
    } finally {
      setBusy(false);
    }
  }

  if (listo) {
    return (
      <div className="border-chrome p-6">
        <p className="font-mono text-[10px] tracking-[0.3em] text-primary">LISTO</p>
        {/* El texto no afirma que la cuenta se creó, porque puede no
            haberse creado: el correo podía existir ya. Decirlo de otra
            forma delataría cuál de los dos casos fue. */}
        <p className="mt-3 font-mono text-sm leading-relaxed">
          Si ese correo no tenía cuenta, ya está creada.
        </p>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          Si ya tenía una, entrá con la contraseña que usaste entonces. Y si la
          habías creado con Google, entrá con Google.
        </p>
        <Link
          href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="surface-chrome sheen mt-5 inline-flex px-6 py-3 font-mono text-xs font-bold tracking-[0.2em]"
        >
          INICIAR SESIÓN
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="border-chrome flex flex-col gap-4 p-6">
      <Campo
        label="CORREO"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="vos@ejemplo.com"
        autoComplete="email"
        disabled={busy}
        required
      />
      <Campo
        label="NOMBRE"
        value={displayName}
        onChange={setDisplayName}
        placeholder="Cómo querés que te llamemos"
        autoComplete="name"
        disabled={busy}
        required
      />
      <Campo
        label="CONTRASEÑA"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        disabled={busy}
        required
        hint="Al menos 10 caracteres."
      />
      <Campo
        label="REPETIR CONTRASEÑA"
        type="password"
        value={password2}
        onChange={setPassword2}
        autoComplete="new-password"
        disabled={busy}
        required
      />
      <Campo
        label="FECHA DE NACIMIENTO"
        type="date"
        value={birthDate}
        onChange={setBirthDate}
        disabled={busy}
        required
        hint="Solo para confirmar que sos mayor de edad. No se muestra en ningún lado."
      />

      <label className="flex items-start gap-2 font-mono text-[11px] leading-snug text-muted-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy}
          className="mt-0.5"
          required
        />
        <span>
          Autorizo el tratamiento de mis datos personales conforme a la{" "}
          <Link href="/privacidad" target="_blank" className="text-primary underline">
            Política de Privacidad
          </Link>
          .
        </span>
      </label>

      {error && (
        <p role="alert" className="font-mono text-[11px] text-primary">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="surface-chrome sheen mt-1 py-3 font-mono text-xs font-bold tracking-[0.2em] disabled:opacity-50"
      >
        {busy ? "CREANDO..." : "CREAR CUENTA"}
      </button>

      <p className="font-mono text-[11px] text-muted-foreground">
        ¿Ya tenés cuenta?{" "}
        <Link
          href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="text-primary underline"
        >
          Iniciar sesión
        </Link>
      </p>
    </form>
  );
}

function Campo({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  disabled,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange(e.target.value)}
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
