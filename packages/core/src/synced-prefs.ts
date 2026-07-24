// 跨裝置同步的設定/偏好（ADR-0242 階段③）：逐鍵 LWW-Register。
//
// 用於「設定/偏好」中**該跨裝置**的項（如每對話靜音 ADR-0217、狀態文字）。刻意**不含**
// 「該裝置本地」項（如該裝置的通知音量、視窗佈局）——那些留在各裝置的 localStorage、永不進此。
// 資料模型：`key → { v, at }`。`v`＝值（字串；空字串＝清除/退回預設）；`at`＝最後設定時間（毫秒）。
// 合併＝逐鍵取 `at` 較新者（平手用 `v` 字典序＝交換律）。純函式，多台任意順序合併結果一致。

/** 同步設定的單一鍵值（LWW-Register）。 */
export interface SyncedPref {
  /** 值（字串；空字串＝清除/退回預設）。複雜值請自行 JSON 序列化。 */
  v: string;
  /** 最後設定時間（毫秒）。 */
  at: number;
}

/** 鍵 → 值的同步設定表。 */
export type SyncedPrefs = Record<string, SyncedPref>;

/** 逐鍵 LWW 合併兩份同步設定（`at` 較新者勝；平手用 `v` 字典序＝交換律）。純函式，不變更輸入。 */
export function mergeSyncedPrefs(a: SyncedPrefs, b: SyncedPrefs): SyncedPrefs {
  const out: SyncedPrefs = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[key];
    const bv = b[key];
    if (av && bv) {
      out[key] = av.at !== bv.at ? (av.at > bv.at ? av : bv) : av.v <= bv.v ? av : bv;
    } else {
      out[key] = (av ?? bv) as SyncedPref;
    }
  }
  return out;
}

/** 單筆同步設定形狀是否合法（快照/外部來源逐筆過濾用）。 */
export function isWellFormedSyncedPref(x: unknown): x is SyncedPref {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return typeof p.v === "string" && typeof p.at === "number";
}
