// 這台裝置的外觀偏好（ADR-0333）：主題／語言／主色。
//
// ## 為什麼要有這個檔案
//
// 桌面一直有 `nb.theme`／`nb.locale`／`nb.accent`（`theme.tsx`／`i18n.tsx`／`accent.tsx`），
// **行動端三個都沒有**——`useState(initialTheme)` 就結束了，重開 App 全部回預設。
//
// 而 `main.tsx` 的註解寫著「使用者在『設定』改的偏好由 App 自行讀回」。
// 那句話對**當時**已經有讀回機制的東西成立，對這三個不成立——**註解比程式碼樂觀**。
//
// ## 與 ADR-0248 的關係
//
// ADR-0248 要求「所有版本**初次登入**一律明亮模式」。**初次＝沒有存過偏好**，
// 所以「使用者明確選過就記住」不牴觸它——`read*` 讀不到值時回傳呼叫端給的預設，
// 而 `main.tsx` 給的預設仍是 `light`。
//
// ## 為什麼是裝置層，不是身分層
//
// 同 ADR-0294 §2 的分類與桌面 `identity-scoped.ts` 的註解：外觀與語言是**整台裝置一致**的東西，
// 切身分不該讓畫面變色。⚠ 桌面的**主色**另有身分層覆寫（ADR-0167，`nb.<pubkey>.accent`）；
// 行動端目前沒有那層，這裡只做裝置層——**不順手補**，那是另一個決策（要不要讓工作身分有自己的顏色）。

import { getKv } from "@cinderous/engine";
import { DEFAULT_VIDEO_QUALITY, isVideoQuality, type VideoQuality } from "@cinderous/core";
import { LOCALES, type Locale } from "@cinderous/i18n";
import type { Theme } from "@cinderous/theme";

const THEME_KEY = "nb.theme";
const LOCALE_KEY = "nb.locale";
const ACCENT_KEY = "nb.accent";
// 視訊通話畫質（ADR-0337）：與桌面同鍵名，兩端語意一致（皆裝置層）。
const VIDEO_QUALITY_KEY = "nb.videoQuality";

/** 讀不到／值不合法時一律回退呼叫端的預設——**壞掉的偏好不該讓 App 起不來**。 */
function read(key: string): string | null {
  try {
    return getKv().getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) getKv().removeItem(key);
    else getKv().setItem(key, value);
  } catch {
    /* 配額／不可用：偏好記不住不影響使用 */
  }
}

export function readTheme(fallback: Theme): Theme {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : fallback;
}

export function saveTheme(t: Theme): void {
  write(THEME_KEY, t);
}

export function readLocale(fallback: Locale): Locale {
  const v = read(LOCALE_KEY);
  return LOCALES.includes(v as Locale) ? (v as Locale) : fallback;
}

export function saveLocale(l: Locale): void {
  write(LOCALE_KEY, l);
}

/**
 * 主色。`null`＝預設色（設定頁的第一格），與「沒設過」是**同一個顯示結果**但語意不同：
 * 存 `"default"` 讓「我選了預設色」與「我沒選過」在讀取時不必分辨——兩者都回 `fallback`。
 * 這裡刻意不引入第三種狀態，因為 UI 上也只有兩種。
 */
export function readAccent(fallback: string | null): string | null {
  const v = read(ACCENT_KEY);
  if (v === null) return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

export function saveAccent(a: string | null): void {
  write(ACCENT_KEY, a);
}

/**
 * 視訊通話畫質（ADR-0337）。裝置層——這是「**這台**的相機與網路」，
 * 與主題／語言同類；切身分不該讓畫質跳掉。
 *
 * 髒值（舊版、手動竄改）一律退回預設，**不讓它傳進 `getUserMedia`**。
 */
export function readVideoQuality(): VideoQuality {
  const v = read(VIDEO_QUALITY_KEY);
  return isVideoQuality(v) ? v : DEFAULT_VIDEO_QUALITY;
}

export function saveVideoQuality(q: VideoQuality): void {
  write(VIDEO_QUALITY_KEY, q);
}
