// 沒在用的身分的新訊息（ADR-0415）。
//
// - **C（預設）**：切換身分時記下「離開時間＋當時未讀數」；切回來後，顯示這段期間多出來的未讀數。
// - **B（設定裡打開才有）**：沒在用的身分各掛一條只讀的收件匣訂閱（引擎 `InboxWatcher`），
//   在身分切換列顯示新訊息數、跳不含寄件人與內文的通知。
//
// 這裡只放本機紀錄與純計算；連線與畫面在 App。

import { shardPath } from "@cinderous/core";

const BG_KEY = "nb.bgInbox";
const AWAY_PREFIX = "nb.away.";

/** 背景收件（B）是否開啟。裝置偏好，預設關。 */
export function bgInboxEnabled(): boolean {
  try {
    return localStorage.getItem(BG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setBgInboxEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(BG_KEY, "1");
    else localStorage.removeItem(BG_KEY);
  } catch {
    /* 無痕模式：這一次記不住 */
  }
}

/** 離開某身分時的紀錄。`at`＝unix 秒；`unread`＝當時的未讀總數。 */
export interface AwayRecord {
  at: number;
  unread: number;
}

export function recordAway(pubkey: string, rec: AwayRecord): void {
  try {
    localStorage.setItem(AWAY_PREFIX + pubkey, JSON.stringify(rec));
  } catch {
    /* 忽略 */
  }
}

/** 讀離開紀錄；壞掉或沒有回 undefined。 */
export function readAway(pubkey: string): AwayRecord | undefined {
  try {
    const raw = localStorage.getItem(AWAY_PREFIX + pubkey);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as Partial<AwayRecord>;
    if (typeof v.at !== "number" || typeof v.unread !== "number") return undefined;
    return { at: v.at, unread: v.unread };
  } catch {
    return undefined;
  }
}

/** 讀出並刪除（C 只在切回來的那一次顯示）。 */
export function takeAway(pubkey: string): AwayRecord | undefined {
  const rec = readAway(pubkey);
  try {
    localStorage.removeItem(AWAY_PREFIX + pubkey);
  } catch {
    /* 忽略 */
  }
  return rec;
}

/** 未讀總數（各對話相加）。 */
export function totalUnread(unread: Record<string, number>): number {
  return Object.values(unread).reduce((a, b) => a + (b > 0 ? b : 0), 0);
}

/** 離開期間多出來的未讀數：別台裝置可能已讀掉一些 → 不會小於 0。 */
export function awayDelta(baseline: number, current: number): number {
  return Math.max(0, current - baseline);
}

/**
 * 某身分的收件匣在哪座中繼（與引擎 `homeUrl` 同一規則）。
 * 工作身分不分片、鎖在公司站；個人身分在分片模式下是自己的訊息片（ADR-0241）。
 */
export function inboxUrlOf(p: { pubkey: string; relayUrl: string; enterprise?: boolean }, sharding: boolean): string {
  return !p.enterprise && sharding ? `${p.relayUrl}${shardPath(p.pubkey)}` : p.relayUrl;
}

/** 背景連線的錯開延遲（毫秒）：不跟作用中身分同時連上（ADR-0415 §3）。 */
export function bgStartDelayMs(random: () => number = Math.random): number {
  return 5_000 + Math.floor(random() * 25_000);
}
