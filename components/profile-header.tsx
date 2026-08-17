"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Eye, EyeOff, Check, X } from "lucide-react";
import { updateMyProfile } from "@/lib/actions";

function maskCedula(cedula: string) {
  if (cedula.length <= 4) return cedula;
  return "•".repeat(cedula.length - 4) + cedula.slice(-4);
}

export function ProfileHeader({
  name,
  email,
  image,
  ordersCount,
  ticketsCount,
  initialPhone,
  initialCedula,
  initialHasConsent,
}: {
  name: string;
  email: string;
  image?: string | null;
  ordersCount: number;
  ticketsCount: number;
  initialPhone: string | null;
  initialCedula: string | null;
  initialHasConsent: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [cedula, setCedula] = useState(initialCedula ?? "");
  const [savedPhone, setSavedPhone] = useState(initialPhone ?? "");
  const [savedCedula, setSavedCedula] = useState(initialCedula ?? "");
  const [hasConsent, setHasConsent] = useState(initialHasConsent);
  const [consentChecked, setConsentChecked] = useState(false);
  const [showCedula, setShowCedula] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const needsConsent = !hasConsent && (phone.trim() || cedula.trim());

  const save = () => {
    setError(null);
    if (needsConsent && !consentChecked) {
      setError("Marcá la casilla de autorización para guardar estos datos.");
      return;
    }
    startTransition(async () => {
      const result = await updateMyProfile({ phone, cedula, consent: consentChecked });
      if ("error" in result) {
        setError(
          result.error === "invalid_phone"
            ? "Ese número de teléfono no se ve válido."
            : result.error === "invalid_cedula"
              ? "Esa cédula no se ve válida (solo números)."
              : result.error === "consent_required"
                ? "Marcá la casilla de autorización para guardar estos datos."
                : result.error === "rate_limited"
                  ? "Esperá unos segundos antes de guardar de nuevo."
                  : "Algo falló. Probá de nuevo."
        );
        return;
      }
      setSavedPhone(phone);
      setSavedCedula(cedula);
      if (consentChecked) setHasConsent(true);
      setEditing(false);
    });
  };

  const cancel = () => {
    setPhone(savedPhone);
    setCedula(savedCedula);
    setConsentChecked(false);
    setError(null);
    setEditing(false);
  };

  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col gap-8 border-b border-border pb-10 sm:flex-row sm:items-start">
      <div className="flex shrink-0 justify-center sm:justify-start">
        {image ? (
          <img src={image} alt={name} className="h-24 w-24 rounded-full border-chrome object-cover sm:h-32 sm:w-32" />
        ) : (
          <div className="border-chrome flex h-24 w-24 items-center justify-center rounded-full text-2xl font-bold text-chrome sm:h-32 sm:w-32">
            {initials}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 text-center sm:text-left">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
          <h1 className="text-3xl font-bold leading-none">{name}</h1>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 border border-border px-3 py-1.5 font-mono text-[10px] tracking-widest text-foreground/80 hover:border-primary hover:text-primary"
            >
              <Pencil className="h-3 w-3" /> EDITAR PERFIL
            </button>
          )}
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{email}</p>

        <div className="mt-4 flex justify-center gap-6 font-mono text-xs tracking-widest sm:justify-start">
          <span>
            <strong className="text-foreground">{ordersCount}</strong>{" "}
            <span className="text-muted-foreground">PEDIDOS</span>
          </span>
          <span>
            <strong className="text-foreground">{ticketsCount}</strong>{" "}
            <span className="text-muted-foreground">TIQUETES</span>
          </span>
        </div>

        {!editing && (savedPhone || savedCedula) && (
          <div className="mt-4 flex flex-col gap-1 font-mono text-xs text-muted-foreground sm:items-start">
            {savedPhone && <div>Tel: {savedPhone}</div>}
            {savedCedula && (
              <div className="flex items-center gap-2">
                CC: {showCedula ? savedCedula : maskCedula(savedCedula)}
                <button onClick={() => setShowCedula((s) => !s)} aria-label="Mostrar cédula">
                  {showCedula ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="mt-6 flex max-w-sm flex-col gap-3 text-left">
            <div>
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">TELÉFONO</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+57 300 000 0000"
                className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">CÉDULA (CC)</label>
              <input
                type="text"
                inputMode="numeric"
                value={cedula}
                onChange={(e) => setCedula(e.target.value)}
                placeholder="1000000000"
                className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
              />
            </div>

            {needsConsent && (
              <label className="flex items-start gap-2 font-mono text-[11px] leading-snug text-muted-foreground">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Autorizo el tratamiento de mis datos personales conforme a la{" "}
                  <Link href="/privacidad" target="_blank" className="text-primary underline">
                    Política de Privacidad
                  </Link>
                  .
                </span>
              </label>
            )}

            {error && <p className="font-mono text-xs text-primary">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={isPending}
                className="surface-chrome sheen inline-flex flex-1 items-center justify-center gap-1 py-2 font-mono text-xs tracking-widest disabled:opacity-40"
              >
                <Check className="h-3 w-3" /> {isPending ? "GUARDANDO..." : "GUARDAR"}
              </button>
              <button
                onClick={cancel}
                disabled={isPending}
                className="inline-flex items-center justify-center gap-1 border border-border px-4 py-2 font-mono text-xs tracking-widest text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> CANCELAR
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
