// 更新偵測（ADR-0228 B）：semver 版本比較與「是否有更新」判定。純函式，可完整於 node 測試。
// fetch 由各平台注入（desktop/mobile 共用此邏輯，不綁 Tauri）。

/** 比較兩個 `x.y.z` 版本：a<b 回 -1、a=b 回 0、a>b 回 1。非數字段視為 0、缺段補 0。 */
export function compareVersion(a: string, b: string): number {
  const seg = (s: string): number[] => s.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = seg(a);
  const pb = seg(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** 遠端 release 條目（更新偵測只需版本與是否已發布；其餘欄位忽略）。 */
export interface RemoteRelease {
  version: string;
  /** `false`＝未發布（hold 中的草稿），不列入「可更新」；缺省／true 視為已發布。 */
  released?: boolean;
}

/**
 * 判斷遠端是否有比 `current` 新的**已發布**版本（ADR-0228）。
 * 取遠端所有 `released !== false` 條目中的最大 semver，若嚴格大於 `current` 回該版本字串，否則回 null。
 * 不假設遠端已排序；格式不符／空／全未發布皆回 null。
 */
export function newerRelease(remote: readonly RemoteRelease[], current: string): string | null {
  if (!Array.isArray(remote)) return null;
  let latest: string | null = null;
  for (const r of remote) {
    if (!r || typeof r.version !== "string" || r.released === false) continue;
    if (latest === null || compareVersion(r.version, latest) > 0) latest = r.version;
  }
  if (latest === null) return null;
  return compareVersion(latest, current) > 0 ? latest : null;
}
