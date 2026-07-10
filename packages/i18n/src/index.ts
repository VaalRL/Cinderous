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

// ── 執行期語系包（ADR-0074 K3 縫）──────────────────────────────────────────────
// 社群可在**不改原始碼**下新增語言：`registerLocale("ja", { ...完整訊息 })`。
// 內建語系（catalog）優先；未命中才查執行期註冊；仍無則回退預設。
const runtimeCatalog: Record<string, Messages> = {};

/** 註冊執行期語系包（K3）；`code` 為 BCP-47 之類的語系碼，`messages` 需完整覆蓋 `Messages`。 */
export function registerLocale(code: string, messages: Messages): void {
  runtimeCatalog[code] = messages;
}

/** 目前可用的語系碼（內建＋執行期註冊）。 */
export function availableLocales(): string[] {
  return [...LOCALES, ...Object.keys(runtimeCatalog).filter((c) => !LOCALES.includes(c as Locale))];
}

/** 翻譯單一鍵；找不到語系或鍵時回退至預設語系，仍無則回傳鍵名。`locale` 接受內建或執行期註冊的碼。 */
export function translate(locale: Locale | string, key: MessageKey, params?: TranslateParams): string {
  const dict = (catalog as Record<string, Messages>)[locale] ?? runtimeCatalog[locale] ?? catalog[DEFAULT_LOCALE];
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

export function createT(locale: Locale | string): TFunction {
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
