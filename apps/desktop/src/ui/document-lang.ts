import type { Locale } from "@cinderous/i18n";

/** 可被同步 lang 的最小目標介面（方便測試注入假物件）。 */
export interface LangTarget {
  documentElement: { lang: string };
}

/**
 * 將語系同步到文件根元素的 `lang` 屬性（BCP-47），
 * 供螢幕閱讀器發音、瀏覽器斷字與翻譯判斷使用。
 * `zh-Hant` / `en` 皆為合法 BCP-47 子標籤，直接沿用。
 * SSR 或無 document 環境下靜默略過。
 */
export function syncDocumentLang(
  locale: Locale,
  target: LangTarget | undefined = typeof document !== "undefined" ? document : undefined,
): void {
  if (target) target.documentElement.lang = locale;
}
