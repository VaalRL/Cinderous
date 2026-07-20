// 裝置 id（ADR-0071）：雲端快照的 `d` tag——裝置級（跨身分共用）、首次產生後固定。
// relay 端以 (pubkey, kind, d) 取代舊快照，故同裝置重複備份不堆積。

import { getKv } from "../kv.js";

const KEY = "nb.deviceId";

/** 取得（或首次產生）此裝置的固定 id（16 hex）。KV 不可用時回退固定值。 */
export function getDeviceId(): string {
  try {
    const kv = getKv();
    const existing = kv.getItem(KEY);
    if (existing) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    kv.setItem(KEY, id);
    return id;
  } catch {
    return "dev";
  }
}
