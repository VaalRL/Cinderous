// 自訂資產庫（ADR-0032 貼圖 → ADR-0220 統一 emoji＋貼圖）：本地保存使用者擁有的自訂資產。
//
// 「擁有」的來源：自 SVG/圖片匯入、fork 現有、或「對話中被展示且點擊／收到自動收藏」。
// id 一律為 contentHash(svg)（sha256），天然去重；純陣列運算可於 node 測試。
// 貼圖與 emoji 同源，差別只在 kind／有無 shortcode（打 :shortcode: 行內插入）。
// 儲存改走 ADR-0219 getKv()（RN 可換式），取代原本直呼 localStorage（ADR-0220）。

import {
  clampStickerLabel,
  contentHash,
  isValidShortcode,
  validateStickerSvg,
  type CustomAsset,
  type CustomAssetKind,
  type SvgVerdict,
} from "@cinderous/core";
import { getKv } from "@cinderous/engine";

/** 統一自訂資產（ADR-0220）；沿用 CustomSticker 名稱以相容既有引用。 */
export type CustomSticker = CustomAsset;

/** 資產庫上限（張）。 */
export const LIBRARY_MAX = 32;

/** 虛擬包名：讓自訂資產融入最近使用/我的最愛的 {pack,id} 參照。 */
export const CUSTOM_PACK = "__custom";

const LIB_KEY = "nb.stickers.custom";

export type AddResult =
  | { ok: true; list: CustomAsset[]; sticker: CustomAsset }
  | { ok: false; reason: string };

/**
 * 加入資產庫（純函式）：驗證 SVG →（選）驗證短碼合法與唯一 → 內容雜湊去重
 *（已擁有則原樣返回）→ 上限檢查。有短碼者 kind 預設 "both"（可當貼圖也可當 emoji）。
 */
export function addSticker(
  list: CustomAsset[],
  label: string,
  svg: string,
  opts: { shortcode?: string; kind?: CustomAssetKind } = {},
): AddResult {
  const verdict: SvgVerdict = validateStickerSvg(svg);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const id = contentHash(svg);
  const shortcode = opts.shortcode?.trim();
  if (shortcode) {
    if (!isValidShortcode(shortcode)) return { ok: false, reason: "bad-shortcode" };
    const taken = list.find((s) => s.shortcode === shortcode && s.id !== id);
    if (taken) return { ok: false, reason: "shortcode-taken" };
  }
  const existing = list.find((s) => s.id === id);
  if (existing) return { ok: true, list, sticker: existing };
  if (list.length >= LIBRARY_MAX) return { ok: false, reason: "library-full" };
  const kind: CustomAssetKind = opts.kind ?? (shortcode ? "both" : "sticker");
  const sticker: CustomAsset = {
    id,
    label: clampStickerLabel(label) || "貼圖",
    svg,
    kind,
    ...(shortcode ? { shortcode } : {}),
  };
  return { ok: true, list: [sticker, ...list], sticker };
}

/** 移除資產（純函式）。 */
export function removeSticker(list: CustomAsset[], id: string): CustomAsset[] {
  return list.filter((s) => s.id !== id);
}

export function findSticker(list: CustomAsset[], id: string): CustomAsset | undefined {
  return list.find((s) => s.id === id);
}

/** 依短碼查資產（供行內 :shortcode: 解析與送出組清單）。 */
export function findByShortcode(list: CustomAsset[], shortcode: string): CustomAsset | undefined {
  const code = shortcode.trim();
  if (!code) return undefined;
  return list.find((s) => s.shortcode === code);
}

/** 指派／更換既有資產的短碼（純函式）：驗證合法＋唯一；成功回新 list（kind→both）。 */
export function setShortcode(list: CustomAsset[], id: string, shortcode: string): AddResult {
  const code = shortcode.trim();
  if (!isValidShortcode(code)) return { ok: false, reason: "bad-shortcode" };
  if (list.some((s) => s.shortcode === code && s.id !== id)) return { ok: false, reason: "shortcode-taken" };
  const target = list.find((s) => s.id === id);
  if (!target) return { ok: false, reason: "not-found" };
  const updated: CustomAsset = { ...target, shortcode: code, kind: "both" };
  return { ok: true, list: list.map((s) => (s.id === id ? updated : s)), sticker: updated };
}

// ── 儲存（ADR-0219 getKv；預設 localStorage、RN 可注入；graceful fail）──

/** 正規化一筆（舊資料無 kind／shortcode）；不合法回 null。 */
function normalize(s: unknown): CustomAsset | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.label !== "string" || typeof o.svg !== "string") return null;
  const kind: CustomAssetKind =
    o.kind === "emoji" || o.kind === "both" || o.kind === "sticker" ? o.kind : "sticker";
  const shortcode =
    typeof o.shortcode === "string" && isValidShortcode(o.shortcode) ? o.shortcode : undefined;
  return { id: o.id, label: o.label, svg: o.svg, kind, ...(shortcode ? { shortcode } : {}) };
}

export function loadLibrary(): CustomAsset[] {
  try {
    const raw = getKv().getItem(LIB_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((s): s is CustomAsset => s !== null);
  } catch {
    return [];
  }
}

export function saveLibrary(list: CustomAsset[]): void {
  getKv().setItem(LIB_KEY, JSON.stringify(list));
}

// ── 收到自動收藏開關（ADR-0220，步驟 5）；預設開 ──

const AUTO_ACQUIRE_KEY = "nb.stickers.autoAcquire";

/** 收到別人的自訂 emoji／貼圖時是否自動收藏進庫（預設開）。 */
export function autoAcquireEnabled(): boolean {
  return getKv().getItem(AUTO_ACQUIRE_KEY) !== "0";
}

export function setAutoAcquireEnabled(on: boolean): void {
  getKv().setItem(AUTO_ACQUIRE_KEY, on ? "1" : "0");
}
