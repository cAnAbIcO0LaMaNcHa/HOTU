"use client";

import { useState } from "react";
import { LANGUAGES, useLanguage } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Idioma"
        aria-expanded={open}
        className="border border-border px-2 py-1 font-mono text-xs tracking-widest text-foreground/80 hover:border-primary hover:text-primary"
      >
        {current.label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-32 border border-border bg-background">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => {
                  setLang(l.code);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left font-mono text-xs tracking-widest hover:bg-card ${
                  l.code === lang ? "text-primary" : "text-foreground/80"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
