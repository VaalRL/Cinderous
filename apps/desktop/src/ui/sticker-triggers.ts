// 文字觸發貼圖（ADR-0037）：觸發字 → 貼圖參照的本地對照表。
//
// 純函式運算 + localStorage 薄包裝（同 sticker-prefs 模式）。
// 比對規則：composer 尾端等於觸發字前綴且長度 ≥2（單字觸發需完整命中）。

import type { StickerRef } from "./sticker-prefs.js";

export interface TriggerEntry {
  /** 正規化後的觸發字（trim、拉丁字母小寫）。 */
  trigger: string;
  ref: StickerRef;
}

export interface TriggerMatch {
  entry: TriggerEntry;
  /** 命中的字元數（自 composer 尾端剝離用）。 */
  matchedLen: number;
  exact: boolean;
}

export const TRIGGER_MAX_LEN = 16;
export const TRIGGERS_MAX = 64;
/** 建議列上限。 */
export const TRIGGER_SUGGEST_MAX = 5;

const KEY = "nb.stickers.triggers";

/** 正規化觸發字；空或超長回傳 undefined。 */
export function normalizeTrigger(raw: string): string | undefined {
  const t = raw.trim().toLowerCase();
  return t.length >= 1 && t.length <= TRIGGER_MAX_LEN ? t : undefined;
}

const sameRef = (a: StickerRef, b: StickerRef): boolean => a.pack === b.pack && a.id === b.id;

export type SetTriggerResult =
  | { ok: true; list: TriggerEntry[]; replaced?: StickerRef }
  | { ok: false; reason: "invalid" | "full" };

/**
 * 設定觸發字（純函式）：同觸發字已存在時覆蓋（回報 `replaced` 原參照）。
 */
export function setTrigger(list: TriggerEntry[], rawTrigger: string, ref: StickerRef): SetTriggerResult {
  const trigger = normalizeTrigger(rawTrigger);
  if (!trigger) return { ok: false, reason: "invalid" };
  const existing = list.find((e) => e.trigger === trigger);
  if (existing) {
    if (sameRef(existing.ref, ref)) return { ok: true, list };
    return {
      ok: true,
      list: list.map((e) => (e.trigger === trigger ? { trigger, ref } : e)),
      replaced: existing.ref,
    };
  }
  if (list.length >= TRIGGERS_MAX) return { ok: false, reason: "full" };
  return { ok: true, list: [...list, { trigger, ref }] };
}

/** 移除某觸發字（純函式）。 */
export function removeTrigger(list: TriggerEntry[], rawTrigger: string): TriggerEntry[] {
  const trigger = normalizeTrigger(rawTrigger);
  return trigger ? list.filter((e) => e.trigger !== trigger) : list;
}

/** 某貼圖目前的所有觸發字。 */
export function triggersFor(list: TriggerEntry[], ref: StickerRef): string[] {
  return list.filter((e) => sameRef(e.ref, ref)).map((e) => e.trigger);
}

/** 移除某貼圖的所有觸發字（重設清單前用）。 */
export function removeTriggersFor(list: TriggerEntry[], ref: StickerRef): TriggerEntry[] {
  return list.filter((e) => !sameRef(e.ref, ref));
}

/**
 * 比對 composer 尾端（ADR-0037）：
 * 尾端等於觸發字前綴且長度 ≥2 即建議；單字觸發需完整命中。
 * 排序：完整命中優先 → 命中長度降冪 → 觸發字字典序；上限 5 筆。
 */
export function matchTriggers(text: string, list: TriggerEntry[]): TriggerMatch[] {
  const tail = text.slice(-TRIGGER_MAX_LEN).toLowerCase();
  if (tail.length === 0) return [];
  const out: TriggerMatch[] = [];
  for (const entry of list) {
    const maxK = Math.min(entry.trigger.length, tail.length);
    let k = 0;
    for (let n = maxK; n >= 1; n--) {
      if (tail.endsWith(entry.trigger.slice(0, n))) {
        k = n;
        break;
      }
    }
    const exact = k === entry.trigger.length;
    if (k >= 2 || (exact && k >= 1)) out.push({ entry, matchedLen: k, exact });
  }
  out.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.matchedLen - a.matchedLen ||
      a.entry.trigger.localeCompare(b.entry.trigger),
  );
  return out.slice(0, TRIGGER_SUGGEST_MAX);
}

// ── localStorage 薄包裝 ──

export function loadTriggers(): TriggerEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is TriggerEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as TriggerEntry).trigger === "string" &&
        !!(e as TriggerEntry).ref &&
        typeof (e as TriggerEntry).ref.pack === "string" &&
        typeof (e as TriggerEntry).ref.id === "string",
    );
  } catch {
    return [];
  }
}

export function saveTriggers(list: TriggerEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 配額或不可用時忽略 */
  }
}
