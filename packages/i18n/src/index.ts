import {
  catalog,
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  type Messages,
} from "./messages.js";

export * from "./messages.js";

export type MessageKey = keyof Messages;
export type TranslateParams = Record<string, string | number>;

/** 翻譯單一鍵；找不到語系或鍵時回退至預設語系，仍無則回傳鍵名。 */
export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  const dict = catalog[locale] ?? catalog[DEFAULT_LOCALE];
  let text = dict[key] ?? catalog[DEFAULT_LOCALE][key] ?? String(key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return text;
}

/** 綁定語系的翻譯函式。 */
export type TFunction = (key: MessageKey, params?: TranslateParams) => string;

export function createT(locale: Locale): TFunction {
  return (key, params) => translate(locale, key, params);
}

/** 由偏好語言字串（如 navigator.language / Accept-Language）推測支援的語系。 */
export function detectLocale(preferred: string | null | undefined): Locale {
  if (!preferred) return DEFAULT_LOCALE;
  const lower = preferred.toLowerCase();
  if (lower.startsWith("zh")) return "zh-Hant";
  if (lower.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

/** 將任意字串收斂為支援的語系（無效則回退預設）。 */
export function asLocale(value: string | null | undefined): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}
