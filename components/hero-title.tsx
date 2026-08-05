"use client";

import { useLanguage } from "@/lib/i18n";

export function HeroTitle() {
  const { t } = useLanguage();
  return (
    <h1 className="text-5xl font-bold uppercase leading-[0.9] md:text-7xl lg:text-8xl">
      <span className="block">{t("heroLine1")}</span>
      <span className="block">{t("heroLine2")}</span>
    </h1>
  );
}
