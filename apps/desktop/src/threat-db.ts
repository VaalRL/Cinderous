// 威脅情報 snapshot 拉取與快取（ADR-0231 P2）：開機自官網拉 threat-intel.json（每日節流、
// 失敗靜默）、getKv 快取原始 JSON、core `parseThreatSnapshot` 還原 ThreatDb 供比對（P3 遮罩用）。
// 隱私：只「拉」靜態檔（與更新檢查同級、opt-in 可關）——比對純本地，絕不送 URL/host 出去。

import { parseThreatSnapshot, type ThreatDb } from "@cinderous/core";
import { getKv } from "@cinderous/engine";
import { shouldCheck } from "./update-check.js";

/** snapshot 來源（官網 GitHub Pages；排程每日重建，ADR-0231 P2）。 */
export const THREAT_ENDPOINT = "https://vaalrl.github.io/Cinderous/threat-intel.json";

const ENABLED_KEY = "nb.threatIntel.enabled";
const CACHE_KEY = "nb.threatIntel.snapshot";
const LAST_KEY = "nb.threatIntel.lastFetch";

/** 威脅情報遮罩是否啟用（預設開、可關；P3 設定四項之一）。 */
export function threatIntelEnabled(): boolean {
  return getKv().getItem(ENABLED_KEY) !== "0";
}

export function setThreatIntelEnabled(on: boolean): void {
  getKv().setItem(ENABLED_KEY, on ? "1" : "0");
}

/** 上次拉取時間（每日節流依據；與 update-check 共用 `shouldCheck` 語意）。 */
export function lastThreatFetch(): number | null {
  const raw = getKv().getItem(LAST_KEY);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** 讀本機快取的 snapshot → ThreatDb；無快取／壞資料回 null。 */
export function loadCachedThreatDb(): ThreatDb | null {
  const raw = getKv().getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return parseThreatSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 自官網拉最新 snapshot：成功→寫入快取並回 ThreatDb；任何失敗（離線／被擋／格式壞）
 * 靜默回 null（呼叫端沿用既有快取）。`fetchFn` 注入以便測試。
 */
export async function refreshThreatDb(
  fetchFn: typeof fetch = fetch,
  endpoint: string = THREAT_ENDPOINT,
  now: number = Date.now(),
): Promise<ThreatDb | null> {
  try {
    const res = await fetchFn(endpoint, { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const db = parseThreatSnapshot(data);
    if (!db) return null;
    getKv().setItem(CACHE_KEY, JSON.stringify(data));
    getKv().setItem(LAST_KEY, String(now));
    return db;
  } catch {
    return null;
  }
}

/**
 * 開機載入（App 用）：先回快取；啟用中且距上次拉取滿一日→背景拉新版，成功以 `onFresh` 通知。
 */
export function bootThreatDb(onFresh: (db: ThreatDb) => void): ThreatDb | null {
  const cached = loadCachedThreatDb();
  if (!threatIntelEnabled()) return cached;
  const now = Date.now();
  if (shouldCheck(lastThreatFetch(), now)) {
    void refreshThreatDb(fetch, THREAT_ENDPOINT, now).then((db) => {
      if (db) onFresh(db);
    });
  }
  return cached;
}
