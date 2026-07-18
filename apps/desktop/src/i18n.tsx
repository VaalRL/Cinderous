import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { asLocale, createT, detectLocale, type Locale, type TFunction } from "@cinderous/i18n";
import { syncDocumentLang } from "./ui/document-lang.js";

const STORAGE_KEY = "nb.locale";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return asLocale(saved);
  } catch {
    /* localStorage 不可用時忽略 */
  }
  return detectLocale(typeof navigator !== "undefined" ? navigator.language : null);
}

interface I18nContextValue {
  locale: Locale;
  t: TFunction;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, locale: fixed }: { children: ReactNode; locale?: Locale }): JSX.Element {
  // `locale` 明確指定時以其為初始值（供測試/內嵌情境固定語系，不受 OS 預設影響）；
  // 省略時沿用既有偵測（localStorage → navigator.language → 預設）。
  const [locale, setLocaleState] = useState<Locale>(fixed ?? initialLocale);
  const setLocale = (next: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 忽略 */
    }
    setLocaleState(next);
  };
  useEffect(() => {
    syncDocumentLang(locale);
  }, [locale]);
  const value = useMemo<I18nContextValue>(() => ({ locale, t: createT(locale), setLocale }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n 必須在 I18nProvider 內使用");
  return ctx;
}
