"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, ShoppingBag, Ticket, CircleUser } from "lucide-react";
import { SubscribeDialog } from "@/components/subscribe-dialog";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLanguage } from "@/lib/i18n";
import { useCart } from "@/components/cart-context";

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const { t } = useLanguage();
  const { count, setOpen: setCartOpen } = useCart();

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
    <>
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <button
            className="text-foreground"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={t("menu")}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>

          <Link href="/" className="flex min-w-0 items-center gap-2" aria-label="HOTU — Inicio">
            <Image
              src="/logo.svg"
              alt="HOTU logo"
              width={30}
              height={30}
              className="h-7 w-7 shrink-0 object-contain"
              priority
              unoptimized
            />
            <span className="whitespace-nowrap text-[clamp(0.75rem,2vw,1.1rem)] font-bold leading-none tracking-tight text-white">
              HOUSE OF THE UNKNOWN
            </span>
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/perfil/tiquetes"
            aria-label={t("tickets")}
            className="border border-border p-1.5 text-foreground/80 hover:border-primary hover:text-primary"
          >
            <Ticket className="h-4 w-4" />
          </Link>
          <button
            onClick={() => setCartOpen(true)}
            aria-label="Carrito"
            className="relative border border-border p-1.5 text-foreground/80 hover:border-primary hover:text-primary"
          >
            <ShoppingBag className="h-4 w-4" />
            {count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground">
                {count}
              </span>
            )}
          </button>
          <LanguageSwitcher />
          <ThemeToggle />
          <Link
            href="/perfil"
            aria-label={t("perfil")}
            className="border border-border p-1.5 text-foreground/80 hover:border-primary hover:text-primary"
          >
            <CircleUser className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Dropdown: full navigation + subscribe + join us */}
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
            className="border border-border px-4 py-3 font-mono text-xs tracking-widest"
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
    </header>

    <SubscribeDialog open={subOpen} onClose={() => setSubOpen(false)} />
    </>
  );
}
