import type { PubkeyHex } from "./keys.js";

/**
 * 記錄每個 key 的「最新一筆」時間戳與附帶值，忽略亂序較舊的更新。
 * 上線狀態、輸入中、音樂狀態等 ephemeral 追蹤器的共用基礎。
 */
export class LatestPerKey<V = undefined> {
  private readonly entries = new Map<PubkeyHex, { at: number; value: V }>();

  /** 記錄一筆；僅當 `at` 嚴格大於既有值時更新。 */
  observe(key: PubkeyHex, at: number, value: V): void {
    const prev = this.entries.get(key);
    if (prev === undefined || at > prev.at) {
      this.entries.set(key, { at, value });
    }
  }

  /** 最新一筆的時間戳。 */
  at(key: PubkeyHex): number | undefined {
    return this.entries.get(key)?.at;
  }

  /** 最新一筆的附帶值。 */
  value(key: PubkeyHex): V | undefined {
    return this.entries.get(key)?.value;
  }
}
