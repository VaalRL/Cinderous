// 更新偵測（ADR-0228 P3）：開機查官網 `releases.json`、以 core `newerRelease` 比對 `APP_VERSION`，
// 有新版在設定「關於」區顯示徽章＋前往下載。opt-in 可關、每日節流、失敗（離線／被擋）靜默。
// 只查版本號 JSON、不送任何使用者資料；自架者可指向自己的 endpoint（同 ADR-0228 決策 1）。

import { newerRelease, type RemoteRelease } from "@cinderous/core";
import { getKv } from "@cinderous/engine";
import { siteFile } from "./site.js";
import { APP_VERSION } from "./version.js";

/** 最新版本查詢來源（官網 GitHub Pages；發版時才部署＝已發布權威）。網域見 `site.ts`（ADR-0235 SEO-6）。 */
export const UPDATE_ENDPOINT = siteFile("releases.json");

/** 「前往下載」目的地（GitHub releases 頁）。 */
export const GITHUB_RELEASES = "https://github.com/VaalRL/Cinderous/releases";

/** 節流間隔：每日至多查一次（ADR-0071 模式）。 */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const ENABLED_KEY = "nb.updateCheck.enabled";
const STATE_KEY = "nb.updateCheck.state";

/** 是否需要查（每日節流，純函式）：從未查過或距上次 ≥ 間隔才查；時鐘倒退視為需要查。 */
export function shouldCheck(lastCheck: number | null | undefined, now: number): boolean {
  if (!lastCheck) return true;
  if (lastCheck > now) return true;
  return now - lastCheck >= CHECK_INTERVAL_MS;
}

/** 查詢結果三態（審查修正）：`ok:false`＝查詢失敗——呼叫端不得覆寫既有狀態、不得記節流時間。 */
export interface UpdateCheckResult {
  ok: boolean;
  /** 可更新版本；null＝已是最新（僅 ok:true 時有意義）。 */
  version: string | null;
}

/**
 * 查官網最新版。「查詢失敗」（離線／被擋／格式壞）與「沒有新版」是不同結果——
 * 失敗回 `ok:false`，呼叫端保留既有徽章並於下次開機重試（不燒 24h 節流窗）。
 * `fetchFn` 注入以便測試（desktop/mobile 共用 core 比對邏輯，不綁 Tauri）。
 */
export async function fetchLatest(
  fetchFn: typeof fetch = fetch,
  endpoint: string = UPDATE_ENDPOINT,
  current: string = APP_VERSION,
): Promise<UpdateCheckResult> {
  try {
    const res = await fetchFn(endpoint, { cache: "no-store" });
    if (!res.ok) return { ok: false, version: null };
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return { ok: false, version: null };
    return { ok: true, version: newerRelease(data as RemoteRelease[], current) };
  } catch {
    return { ok: false, version: null };
  }
}

// ── 設定與狀態（ADR-0219 getKv；預設 localStorage、graceful fail）──

/** 自動檢查更新是否啟用（opt-in，預設開、可關）。 */
export function updateCheckEnabled(): boolean {
  return getKv().getItem(ENABLED_KEY) !== "0";
}

export function setUpdateCheckEnabled(on: boolean): void {
  getKv().setItem(ENABLED_KEY, on ? "1" : "0");
}

/** 檢查狀態：上次檢查時間（節流依據）＋上次查到的可更新版本（開機先顯示、再更新）。 */
export interface UpdateState {
  lastCheck: number;
  available: string | null;
}

export function loadUpdateState(): UpdateState | null {
  const raw = getKv().getItem(STATE_KEY);
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== "object" || p === null) return null;
    const { lastCheck, available } = p as { lastCheck?: unknown; available?: unknown };
    if (typeof lastCheck !== "number") return null;
    return { lastCheck, available: typeof available === "string" ? available : null };
  } catch {
    return null;
  }
}

export function saveUpdateState(state: UpdateState): void {
  getKv().setItem(STATE_KEY, JSON.stringify(state));
}
