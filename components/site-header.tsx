"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, Search } from "lucide-react";

const NAV = [
  { label: "NOTICIAS", href: "/noticias" },
  { label: "EVENTOS", href: "/eventos" },
  { label: "ARTISTAS", href: "/artistas" },
  { label: "COLECTIVOS", href: "/colectivos" },
  { label: "SETS", href: "/sets" },
  { label: "DISCOGRAFÍA", href: "/discografia" },
  { label: "TIENDA", href: "/tienda" },
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="text-xl font-bold leading-none tracking-tight md:text-2xl text-chrome">
            HOUSE OF THE UNKNOWN
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {NAV.map((i) => (
            <Link
              key={i.label}
              href={i.href}
              className="font-mono text-xs tracking-widest text-foreground/80 transition-colors hover:text-primary"
            >
              {i.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button className="text-foreground/80 hover:text-primary" aria-label="Buscar">
            <Search className="h-5 w-5" />
          </button>
          <button
            className="hidden rounded-none px-4 py-2 font-mono text-xs tracking-widest md:inline-flex surface-chrome"
          >
            SUSCRIBIRSE
          </button>
          <button
            className="text-foreground lg:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menú"
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="flex flex-col gap-4 border-t border-border bg-background px-4 py-4 lg:hidden">
          {NAV.map((i) => (
            <Link
              key={i.label}
              href={i.href}
              onClick={() => setMenuOpen(false)}
              className="font-mono text-sm tracking-widest"
            >
              {i.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
