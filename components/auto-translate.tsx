"use client";

import { useEffect, useState } from "react";
import { useLanguage, getApiCode } from "@/lib/i18n";

/**
 * Wraps any piece of Spanish text (bios, descriptions, anything typed into
 * the platform's data files) and automatically translates it into the
 * currently selected language at render time, using a free translation API.
 * Because this runs at render time against whatever text is passed in,
 * ANY new content added later (new artist bio, new collective description,
 * new page copy) is automatically translatable too — no manual per-language
 * fields needed.
 */
export function AutoTranslate({ text }: { text: string }) {
  const { lang } = useLanguage();
  const [output, setOutput] = useState(text);

  useEffect(() => {
    if (lang === "es" || !text) {
      setOutput(text);
      return;
    }

    const apiCode = getApiCode(lang);
    const cacheKey = `hotu-tr:${lang}:${text}`;
    const cached = typeof window !== "undefined" ? sessionStorage.getItem(cacheKey) : null;
    if (cached) {
      setOutput(cached);
      return;
    }

    let cancelled = false;
    fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=es|${apiCode}`)
      .then((r) => r.json())
      .then((data) => {
        const translated = data?.responseData?.translatedText;
        if (!cancelled && translated && typeof translated === "string") {
          setOutput(translated);
          try {
            sessionStorage.setItem(cacheKey, translated);
          } catch {
            // storage full or unavailable — ignore, translation still shown
          }
        }
      })
      .catch(() => {
        // network/API error — keep showing the original Spanish text
      });

    return () => {
      cancelled = true;
    };
  }, [text, lang]);

  return <>{output}</>;
}
