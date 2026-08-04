"use client";

import { useState } from "react";
import { X } from "lucide-react";

export function SubscribeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    await new Promise((r) => setTimeout(r, 600));
    setStatus("success");
    setEmail("");
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative w-full max-w-md border border-primary bg-card p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 text-foreground/70 hover:text-primary"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>

          <span className="font-mono text-[10px] tracking-[0.3em] text-primary">/ ÚNETE A LA CASA</span>
          <h3 className="mt-2 text-2xl font-bold text-chrome">CONECTA CON HOTU</h3>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Eventos, lanzamientos y sets exclusivos cada viernes en tu inbox.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => alert("Falta conectar Google OAuth — próximo paso")}
              className="flex items-center justify-center gap-2 border border-border bg-background px-4 py-3 font-mono text-xs tracking-widest hover:border-primary"
            >
              CONTINUAR CON GOOGLE
            </button>
            <button
              type="button"
              onClick={() => alert("Falta conectar Apple Sign In — próximo paso")}
              className="flex items-center justify-center gap-2 border border-border bg-background px-4 py-3 font-mono text-xs tracking-widest hover:border-primary"
            >
              CONTINUAR CON APPLE
            </button>
          </div>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] text-muted-foreground">O CON TU EMAIL</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setStatus("idle");
              }}
              placeholder="tu@email.com"
              className="border border-border bg-background px-4 py-3 font-mono text-sm focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="px-6 py-3 font-mono text-xs tracking-widest surface-chrome disabled:opacity-50"
            >
              {status === "loading" ? "ENVIANDO..." : "SUBSCRIBIR"}
            </button>
            {status === "error" && (
              <p className="font-mono text-xs text-red-400">Ingresa un email válido.</p>
            )}
            {status === "success" && (
              <p className="font-mono text-xs text-primary">¡Bienvenido a la casa! Revisa tu inbox.</p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
