"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/i18n";

export function SectionSidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const primary = [
    { label: t("noticias"), href: "/noticias" },
    { label: t("eventos"), href: "/eventos" },
    { label: t("colectivos"), href: "/colectivos" },
    { label: t("artistas"), href: "/artistas" },
    { label: t("sets"), href: "/sets" },
  ];
  const secondary = [
    { label: t("discografia"), href: "/discografia" },
    { label: t("tienda"), href: "/tienda" },
  ];

  const renderLink = (item: { label: string; href: string }) => {
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`block border-l-2 py-2 pl-4 font-mono text-xs tracking-widest transition-colors ${
          active
            ? "border-primary text-primary"
            : "border-transparent text-foreground/70 hover:border-border hover:text-foreground"
        }`}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <nav aria-label={t("menu")} className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
      <div className="flex flex-col">{primary.map(renderLink)}</div>
      <div className="mt-6 flex flex-col border-t border-border pt-6">
        {secondary.map(renderLink)}
      </div>
    </nav>
  );
}
