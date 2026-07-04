// 群組本地標籤與置頂（ADR-0040）：純前端偏好，僅存本機、不進協定、不扇出。
//
// 標籤只有自己看得到，用來整理群組清單（分類 + 置頂），與 core `Group`（協定狀態）
// 完全解耦——群組成員/名稱由後端權威維護，這裡只疊加使用者個人的檢視偏好。
// 持久化寫法對齊 url-hygiene.ts（直接用 localStorage，node 測試以 stub 覆蓋）。

/** 單一群組的本地偏好。 */
export interface GroupPrefs {
  labels: string[];
  pinned: boolean;
}

/** groupId → 偏好。未出現的群組視為無標籤、未置頂。 */
export type GroupPrefsMap = Record<string, GroupPrefs>;

const KEY = "nb.groupPrefs";
const MAX_LABEL_LEN = 24;

/** 正規化標籤：收斂空白、去頭尾、長度上限；全空白回傳空字串（呼叫端據此忽略）。 */
export function normalizeLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LEN);
}

function entry(map: GroupPrefsMap, id: string): GroupPrefs {
  return map[id] ?? { labels: [], pinned: false };
}

/** 讀某群組的標籤（預設空陣列）。 */
export function labelsOf(map: GroupPrefsMap, id: string): string[] {
  return map[id]?.labels ?? [];
}

/** 某群組是否置頂（預設否）。 */
export function isPinned(map: GroupPrefsMap, id: string): boolean {
  return map[id]?.pinned ?? false;
}

/** 加一個標籤（正規化、去重、忽略空字串）；回傳新 map（不可變）。 */
export function withLabel(map: GroupPrefsMap, id: string, label: string): GroupPrefsMap {
  const norm = normalizeLabel(label);
  if (!norm) return map;
  const cur = entry(map, id);
  if (cur.labels.includes(norm)) return map;
  return { ...map, [id]: { ...cur, labels: [...cur.labels, norm] } };
}

/** 移除一個標籤；回傳新 map。 */
export function withoutLabel(map: GroupPrefsMap, id: string, label: string): GroupPrefsMap {
  const cur = map[id];
  if (!cur || !cur.labels.includes(label)) return map;
  return { ...map, [id]: { ...cur, labels: cur.labels.filter((l) => l !== label) } };
}

/** 設定置頂狀態；回傳新 map。 */
export function withPinned(map: GroupPrefsMap, id: string, pinned: boolean): GroupPrefsMap {
  return { ...map, [id]: { ...entry(map, id), pinned } };
}

/** 清除某群組的所有偏好（離開/解散時呼叫，避免殘留）。 */
export function pruneGroup(map: GroupPrefsMap, id: string): GroupPrefsMap {
  if (!(id in map)) return map;
  const { [id]: _drop, ...rest } = map;
  return rest;
}

/** 目前使用中的所有標籤（去重、依地區排序），供過濾列顯示。 */
export function allLabels(map: GroupPrefsMap): string[] {
  const set = new Set<string>();
  for (const p of Object.values(map)) for (const l of p.labels) set.add(l);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * 排列群組供顯示：`activeLabel` 有值時只留含該標籤者；置頂者排前面，
 * 同組內維持原順序（穩定排序）。回傳新陣列，不改動輸入。
 */
export function arrangeGroups<T extends { id: string }>(
  groups: T[],
  map: GroupPrefsMap,
  activeLabel?: string,
): T[] {
  const filtered = activeLabel ? groups.filter((g) => labelsOf(map, g.id).includes(activeLabel)) : groups;
  return filtered
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (isPinned(map, b.g.id) ? 1 : 0) - (isPinned(map, a.g.id) ? 1 : 0) || a.i - b.i)
    .map((x) => x.g);
}

/** 從 localStorage 載入偏好；缺失/毀損時回傳空 map，並過濾非法形狀。 */
export function loadGroupPrefs(): GroupPrefsMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: GroupPrefsMap = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
      const labels = Array.isArray(o.labels) ? o.labels.filter((x): x is string => typeof x === "string") : [];
      out[id] = { labels, pinned: o.pinned === true };
    }
    return out;
  } catch {
    return {};
  }
}

/** 寫回 localStorage（配額/不可用時靜默忽略）。 */
export function saveGroupPrefs(map: GroupPrefsMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 配額或不可用時忽略 */
  }
}
