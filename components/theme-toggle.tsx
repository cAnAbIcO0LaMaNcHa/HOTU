"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

const STORAGE_KEY = "hotu-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { t } = useLanguage();

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initial = saved === "light" ? "light" : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={t("tema")}
      className="border border-border p-1.5 text-foreground/80 hover:border-primary hover:text-primary"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
