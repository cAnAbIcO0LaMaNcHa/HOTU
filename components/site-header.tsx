"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, Search } from "lucide-react";
import { SubscribeDialog } from "@/components/subscribe-dialog";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/i18n";

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const { t } = useLanguage();

  const NAV = [
    { label: t("noticias"), href: "/noticias" },
    { label: t("eventos"), href: "/eventos" },
    { label: t("artistas"), href: "/artistas" },
    { label: t("colectivos"), href: "/colectivos" },
    { label: t("sets"), href: "/sets" },
    { label: t("discografia"), href: "/discografia" },
    { label: t("tienda"), href: "/tienda" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3" aria-label="HOTU — Inicio">
          <Image
            src="/logo.svg"
            alt="HOTU logo"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 object-contain"
            priority
            unoptimized
          />
          <span className="whitespace-nowrap text-[clamp(0.85rem,2.2vw,1.5rem)] font-bold leading-none tracking-tight text-white">
            HOUSE OF THE UNKNOWN
          </span>
        </Link>

        {/* Top bar: only the 7 main sections */}
        <nav className="hidden items-center gap-6 lg:flex">
          {NAV.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className="whitespace-nowrap font-mono text-xs tracking-widest text-foreground/80 transition-colors hover:text-primary"
            >
              {i.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <LanguageSwitcher />
          <button className="text-foreground/80 hover:text-primary" aria-label={t("buscar")}>
            <Search className="h-5 w-5" />
          </button>
          <button
            onClick={() => setSubOpen(true)}
            className="hidden whitespace-nowrap rounded-none px-4 py-2 font-mono text-xs tracking-widest md:inline-flex surface-chrome"
          >
            {t("suscribirse")}
          </button>
          {/* Dropdown trigger: always visible (desktop + mobile) */}
          <button
            className="text-foreground"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={t("menu")}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Dropdown: the 7 main sections + Sobre Nosotros + Únete a Nosotros (these two ONLY live here) */}
      {menuOpen && (
        <nav className="flex flex-col gap-4 border-t border-border bg-background px-4 py-4">
          {NAV.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={() => setMenuOpen(false)}
              className="font-mono text-sm tracking-widest"
            >
              {i.label}
            </Link>
          ))}
          <Link
            href="/sobre-nosotros"
            onClick={() => setMenuOpen(false)}
            className="font-mono text-sm tracking-widest"
          >
            {t("sobreNosotros")}
          </Link>
          <button
            onClick={() => {
              setMenuOpen(false);
              setSubOpen(true);
            }}
            className="border border-border px-4 py-3 font-mono text-xs tracking-widest md:hidden"
          >
            {t("suscribirse")}
          </button>
          <Link
            href="/aliados"
            onClick={() => setMenuOpen(false)}
            className="mt-2 inline-flex items-center justify-center border border-primary bg-primary px-4 py-3 font-mono text-xs tracking-widest text-primary-foreground"
          >
            {t("uneteANosotros")}
          </Link>
        </nav>
      )}

      <SubscribeDialog open={subOpen} onClose={() => setSubOpen(false)} />
    </header>
  );
}
