"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n";

const CONTACT_EMAIL = "hotuhouseoftheunknow@gmail.com";
const INSTAGRAM_URL =
  "https://www.instagram.com/house_of_the_unknown?igsh=MTU1cjJqdDMxMzdidw==";
const INSTAGRAM_HANDLE = "@house_of_the_unknown";

export function SiteFooter() {
  const { t } = useLanguage();

  const SECTIONS = [
    {
      title: t("footerSecciones"),
      links: [
        { label: t("noticias"), href: "/noticias" },
        { label: t("eventos"), href: "/eventos" },
        { label: t("artistas"), href: "/artistas" },
        { label: t("colectivos"), href: "/colectivos" },
        { label: t("sets"), href: "/sets" },
      ],
    },
    {
      title: t("footerComunidad"),
      links: [
        { label: t("discografia"), href: "/discografia" },
        { label: t("tienda"), href: "/tienda" },
        { label: t("sobreNosotros"), href: "/sobre-nosotros" },
        { label: t("uneteANosotros"), href: "/aliados" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-4">
        <div>
          <span className="text-base font-bold text-chrome">HOUSE OF THE UNKNOWN</span>
          <p className="mt-4 font-mono text-xs text-muted-foreground">{t("footerDesc")}</p>
        </div>
        {SECTIONS.map((s) => (
          <div key={s.title}>
            <h4 className="font-mono text-[10px] tracking-widest text-primary">{s.title}</h4>
            <ul className="mt-4 space-y-2 font-mono text-xs">
              {s.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-foreground/80 hover:text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <h4 className="font-mono text-[10px] tracking-widest text-primary">{t("footerContacto")}</h4>
          <ul className="mt-4 space-y-2 font-mono text-xs">
            <li>
              <Link
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-foreground/80 hover:text-primary"
              >
                {CONTACT_EMAIL}
              </Link>
            </li>
            <li>
              <Link
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground/80 hover:text-primary"
              >
                {INSTAGRAM_HANDLE}
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-6 font-mono text-[10px] tracking-widest text-muted-foreground">
          © 2026 HOUSE OF THE UNKNOWN · BOGOTÁ · {t("footerRights")}
        </div>
      </div>
    </footer>
  );
}
