"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "es" | "en" | "pt" | "fr" | "ru" | "ja" | "zh";

export const LANGUAGES: { code: Lang; label: string; apiCode: string }[] = [
  { code: "es", label: "ES", apiCode: "es" },
  { code: "en", label: "EN", apiCode: "en" },
  { code: "pt", label: "PT", apiCode: "pt" },
  { code: "fr", label: "FR", apiCode: "fr" },
  { code: "ru", label: "RU", apiCode: "ru" },
  { code: "ja", label: "日", apiCode: "ja" },
  { code: "zh", label: "中", apiCode: "zh-CN" },
];

type DictKey =
  | "noticias" | "eventos" | "artistas" | "colectivos" | "sets" | "discografia" | "tienda"
  | "sobreNosotros" | "uneteANosotros" | "suscribirse" | "buscar" | "menu" | "verTodos"
  | "footerSecciones" | "footerComunidad" | "footerContacto" | "footerDesc" | "footerRights"
  | "heroLine1" | "heroLine2" | "nuevos" | "nueva";

const DICT: Record<Lang, Record<DictKey, string>> = {
  es: {
    noticias: "NOTICIAS", eventos: "EVENTOS", artistas: "ARTISTAS", colectivos: "COLECTIVOS",
    sets: "SETS", discografia: "DISCOGRAFÍA", tienda: "TIENDA",
    sobreNosotros: "SOBRE NOSOTROS", uneteANosotros: "ÚNETE A NOSOTROS",
    suscribirse: "SUSCRIBIRSE", buscar: "Buscar", menu: "Menuú", verTodos: "VER TODOS",
    footerSecciones: "SECCIONES", footerComunidad: "COMUNIDAD", footerContacto: "CONTÁCTANOS",
    footerDesc: "Hub digital de cultura electrónica y techno desde Bogotá. HOTU · 2026.",
    footerRights: "TODOS LOS DERECHOS RESERVADOS",
    heroLine1: "BIENVENIDO", heroLine2: "A LA CASA", nuevos: "NUEVOS", nueva: "NUEVA",
  },
  en: {
    noticias: "NEWS", eventos: "EVENTS", artistas: "ARTISTS", colectivos: "COLLECTIVES",
    sets: "SETS", discografia: "DISCOGRAPHY", tienda: "STORE",
    sobreNosotros: "ABOUT US", uneteANosotros: "JOIN US",
    suscribirse: "SUBSCRIBE", buscar: "Search", menu: "Menu", verTodos: "VIEW ALL",
    footerSecciones: "SECTIONS", footerComunidad: "COMMUNITY", footerContacto: "CONTACT US",
    footerDesc: "Digital hub for electronic and techno culture from Bogotá. HOTU · 2026.",
    footerRights: "ALL RIGHTS RESERVED",
    heroLine1: "WELCOME", heroLine2: "HOME", nuevos: "NEW", nueva: "NEW",
  },
  pt: {
    noticias: "NOTÍCIAS", eventos: "EVENTOS", artistas: "ARTISTAS", colectivos: "COLETIVOS",
    sets: "SETS", discografia: "DISCOGRAFIA", tienda: "LOJA",
    sobreNosotros: "SOBRE NÓS", uneteANosotros: "JUNTE-SE A NÓS",
    suscribirse: "INSCREVER-SE", buscar: "Buscar", menu: "Menu", verTodos: "VER TODOS",
    footerSecciones: "SEÇÕES", footerComunidad: "COMUNIDADE", footerContacto: "CONTATO",
    footerDesc: "Hub digital de cultura eletrônica e techno de Bogotá. HOTU · 2026.",
    footerRights: "TODOS OS DIREITOS RESERVADOS",
    heroLine1: "BEM-VINDO", heroLine2: "À CASA", nuevos: "NOVOS", nueva: "NOVA",
  },
  fr: {
    noticias: "ACTUALITÉS", eventos: "ÉVÉNEMENTS", artistas: "ARTISTES", colectivos: "COLLECTIFS",
    sets: "SETS", discografia: "DISCOGRAPHIE", tienda: "BOUTIQUE",
    sobreNosotros: "À PROPOS", uneteANosotros: "REJOIGNEZ-NOUS",
    suscribirse: "S'ABONNER", buscar: "Rechercher", menu: "Menu", verTodos: "VOIR TOUT",
    footerSecciones: "SECTIONS", footerComunidad: "COMMUNAUTÉ", footerContacto: "CONTACT",
    footerDesc: "Hub numérique de culture électronique et techno depuis Bogotá. HOTU · 2026.",
    footerRights: "TOUS DROITS RÉSERVÉS",
    heroLine1: "BIENVENUE", heroLine2: "CHEZ TOI", nuevos: "NOUVEAUX", nueva: "NOUVEAU",
  },
  ru: {
    noticias: "НОВОСТИ", eventos: "СОБҫТИЯ", artistas: "АРТИСТҫ", colectivos: "КОЛЛЕКТИВҫ",
    sets: "СЕТҫ", discografia: "ДИСКОГРАФИЯ", tienda: "МАГАЗИН",
    sobreNosotros: "О НАС", uneteANosotros: "ПРИСОЕДИНүИТЕСЬ",
    suscribirse: "ПОДПИСАТҬСя", buscar: "Поиск", menu: "Меню", verTodos: "СМОТРЕТҬ ВСЕ",
    footerSecciones: "РАЗДЕЛү", footerComunidad: "СООБЩЕСтВО", footerContacto: "КОНТАКТЫ",
    footerDesc: "Цифровой центр электронной и 0tehno-культуры из Боготы. HOTU · 2026.",
    footerRights: "ВСЕ ПРАВА ЗАЩИЩЕНү",
    heroLine1: "ДОБРО ПОЖАЛОВАТЬ", heroLine2: "ДОМОЙ", nuevos: "НОВЫE", nueva: "НОВОЕ",
  },
  ja: {
    noticias: "ニュース", eventos: "イベント", artistas: "アーティスト", colectivos: "コレクティブ",
    sets: "セット", discografia: "ディスコグレフィー", tienda: "ストア",
    sobreNosotros: "私たちについて", uneteANosotros: "参加する",
    suscribirse: "登録する", buscar: "検索", menu: "メニュー", verTodos: "すべて見る",
    footerSecciones: "セックション", footerComunidad: "コミュニティ", footerContacto: "お問い合わせ",
    footerDesc: "ボゴタ発、エレクトロニック＆テノ文化のデジタルハブ。HOTU・2026年。",
    footerRights: "全著作権所有",
    heroLine1: "ようこそ", heroLine2: "我が家へ", nuevos: "新着", nueva: "新着",
  },
  zh: {
    noticias: "新闻", eventos: "活动", artistas: "艺术家", colectivos: "团体",
    sets: "现场演出", discografia: "唱片目录", tienda: "商店",
    sobreNosotros: "关于我们", uneteANosotros: "加入我们",
    suscribirse: "订阅", buscar: "搜索", menu: "菜单", verTodos: "查看全部",
    footerSecciones: "板块", footerComunidad: "社区", footerContacto: "联系我们",
    footerDesc: "来自波哥大的电子与techno文化数字中心。HOTU · 2026年。",
    footerRights: "版权所有",
    heroLine1: "欢迎", heroLine2: "回家", nuevos: "最新", nueva: "最新",
  },
};

type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: DictKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "hotu-lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem(STORAGE_KEY) as Lang | null) : null;
    if (saved && DICT[saved]) setLangState(saved);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, l);
  };

  const t = (key: DictKey) => DICT[lang]?.[key] ?? DICT.es[key] ?? key;

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}

export function getApiCode(lang: Lang) {
  return LANGUAGES.find((l) => l.code === lang)?.apiCode ?? "en";
}
