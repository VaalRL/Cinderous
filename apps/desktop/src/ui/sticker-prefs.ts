// 貼圖偏好（最近使用 / 我的最愛）：純本地，不經協定與後端。
//
// 陣列運算為純函式（可於 node 測試）；localStorage 讀寫為薄包裝。
// 儲存內容僅為 `pack/id` 參照，體積極小、無隱私疑慮。

export interface StickerRef {
  pack: string;
  id: string;
}

export const RECENT_MAX = 16;
const RECENT_KEY = "nb.stickers.recent";
const FAV_KEY = "nb.stickers.fav";

export function refEquals(a: StickerRef, b: StickerRef): boolean {
  return a.pack === b.pack && a.id === b.id;
}

/** 加入最近使用：移到最前、去重、上限截斷（純函式）。 */
export function addRecent(list: StickerRef[], ref: StickerRef, max: number = RECENT_MAX): StickerRef[] {
  return [ref, ...list.filter((r) => !refEquals(r, ref))].slice(0, max);
}

export function isFavorite(list: StickerRef[], ref: StickerRef): boolean {
  return list.some((r) => refEquals(r, ref));
}

/** 切換我的最愛：已存在則移除、否則加到最前（純函式）。 */
export function toggleFavorite(list: StickerRef[], ref: StickerRef): StickerRef[] {
  return isFavorite(list, ref) ? list.filter((r) => !refEquals(r, ref)) : [ref, ...list];
}

// ── localStorage 薄包裝 ──

function readRefs(key: string): StickerRef[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is StickerRef =>
        !!r && typeof r === "object" && typeof (r as StickerRef).pack === "string" && typeof (r as StickerRef).id === "string",
    );
  } catch {
    return [];
  }
}

function writeRefs(key: string, refs: StickerRef[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(refs));
  } catch {
    /* 配額或不可用時忽略 */
  }
}

export function loadRecent(): StickerRef[] {
  return readRefs(RECENT_KEY);
}

export function recordRecent(ref: StickerRef): StickerRef[] {
  const next = addRecent(loadRecent(), ref);
  writeRefs(RECENT_KEY, next);
  return next;
}

export function loadFavorites(): StickerRef[] {
  return readRefs(FAV_KEY);
}

export function saveFavorites(refs: StickerRef[]): void {
  writeRefs(FAV_KEY, refs);
}
