// 自製貼圖庫（ADR-0032）：本地保存使用者擁有的自製貼圖。
//
// 「擁有」的來源：自 SVG/圖片匯入、fork 現有貼圖、或「對話中被展示且點擊」。
// id 一律為 contentHash(svg)（sha256），天然去重；純陣列運算可於 node 測試。

import { contentHash } from "@nostr-buddy/core";
import { validateStickerSvg, type SvgVerdict } from "./sticker-svg.js";

export interface CustomSticker {
  /** contentHash(svg)。 */
  id: string;
  label: string;
  svg: string;
}

/** 貼圖庫上限（張）。 */
export const LIBRARY_MAX = 32;

/** 虛擬包名：讓自製貼圖融入最近使用/我的最愛的 {pack,id} 參照。 */
export const CUSTOM_PACK = "__custom";

const LIB_KEY = "nb.stickers.custom";

export type AddResult =
  | { ok: true; list: CustomSticker[]; sticker: CustomSticker }
  | { ok: false; reason: string };

/**
 * 加入貼圖庫（純函式）：驗證 → 內容雜湊 → 去重（已擁有則原樣返回）→ 上限檢查。
 */
export function addSticker(list: CustomSticker[], label: string, svg: string): AddResult {
  const verdict: SvgVerdict = validateStickerSvg(svg);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const id = contentHash(svg);
  const existing = list.find((s) => s.id === id);
  if (existing) return { ok: true, list, sticker: existing };
  if (list.length >= LIBRARY_MAX) return { ok: false, reason: "library-full" };
  const sticker: CustomSticker = { id, label: label.trim() || "貼圖", svg };
  return { ok: true, list: [sticker, ...list], sticker };
}

/** 移除貼圖（純函式）。 */
export function removeSticker(list: CustomSticker[], id: string): CustomSticker[] {
  return list.filter((s) => s.id !== id);
}

export function findSticker(list: CustomSticker[], id: string): CustomSticker | undefined {
  return list.find((s) => s.id === id);
}

// ── localStorage 薄包裝 ──

export function loadLibrary(): CustomSticker[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is CustomSticker =>
        !!s &&
        typeof s === "object" &&
        typeof (s as CustomSticker).id === "string" &&
        typeof (s as CustomSticker).label === "string" &&
        typeof (s as CustomSticker).svg === "string",
    );
  } catch {
    return [];
  }
}

export function saveLibrary(list: CustomSticker[]): void {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
  } catch {
    /* 配額或不可用時忽略 */
  }
}
