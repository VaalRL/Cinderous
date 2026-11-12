// 沒在用的身分的新訊息（ADR-0415）。
//
// - **C（預設）**：切換身分時記下離開時間；切回來後，數這段期間別人寄來的訊息。
// - **B（設定裡打開才有）**：沒在用的身分各掛一條只讀的收件匣訂閱（引擎 `InboxWatcher`），
//   在身分切換列顯示新訊息數、跳不含寄件人與內文的通知。
//
// 這裡只放本機紀錄與純計算；連線與畫面在 App。

import { shardPath } from "@cinderous/core";
import { shouldMuteOrgNotification, shouldNotify, type CountedMessage, type NotifyPrefs, type OrgInfo } from "@cinderous/engine";

const BG_KEY = "nb.bgInbox";
const AWAY_PREFIX = "nb.away.";
const ORG_PREFIX = "nb.orgInfo.";

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

/** 離開某身分時的紀錄。`at`＝unix 秒。 */
export interface AwayRecord {
  at: number;
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
    if (typeof v.at !== "number") return undefined;
    return { at: v.at };
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

/**
 * 切回身分後正在數的「離開期間的訊息」：`since`＝離開時間（unix 秒）、`until`＝切回來的時間（毫秒）；
 * `ids` 去重。切回來之後才送出的不算——那不是「離開期間」收到的。
 */
export interface AwayTally {
  since: number;
  until: number;
  ids: Set<string>;
}

/**
 * 這則訊息算不算「離開期間收到的」，算的話記進 tally 並回 true。
 *
 * 不用未讀數的差：對話視窗開著時訊息一到就標已讀，差永遠是 0（ADR-0415 實機測試）。
 * 自己送的（含別台裝置的副本）、離開前送出的、重複的都不算；訊息請求由呼叫端排除。
 */
export function countAwayMessage(tally: AwayTally | null, msg: { id: string; outgoing: boolean; at: number }): boolean {
  if (!tally || msg.outgoing || msg.at <= tally.since * 1000 || msg.at > tally.until || tally.ids.has(msg.id)) return false;
  tally.ids.add(msg.id);
  return true;
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

/** 背景身分的組織資訊（ADR-0157 下班靜音用）：只在那個身分是作用中時拿得到，所以記在本機。 */
export type StoredOrgInfo = Pick<OrgInfo, "members" | "workHours">;

export function saveOrgInfo(pubkey: string, info: StoredOrgInfo): void {
  try {
    localStorage.setItem(ORG_PREFIX + pubkey, JSON.stringify({ members: info.members, ...(info.workHours ? { workHours: info.workHours } : {}) }));
  } catch {
    /* 忽略 */
  }
}

export function readOrgInfo(pubkey: string): StoredOrgInfo | null {
  try {
    const raw = localStorage.getItem(ORG_PREFIX + pubkey);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredOrgInfo>;
    if (!Array.isArray(v.members)) return null;
    return { members: v.members.filter((x): x is string => typeof x === "string"), ...(v.workHours ? { workHours: v.workHours } : {}) };
  } catch {
    return null;
  }
}

/**
 * 背景身分剛數到的這一則要不要跳通知——跟正常收訊走**同一組閘門**（ADR-0217／0157）：
 * 總開關、1:1／群組事件開關（含 @我）、每對話靜音、組織下班靜音。
 * 背景身分的訊息永遠不在畫面上 → 視窗聚焦與否不影響（windowHidden 一律為真）。
 */
export function bgShouldNotify(ctx: {
  prefs: NotifyPrefs;
  masterOn: boolean;
  latest: CountedMessage;
  muted: ReadonlySet<string>;
  org: StoredOrgInfo | null;
  /** 組織群組（`StoredGroup.org`）的 id。 */
  orgGroups: ReadonlySet<string>;
  /** 當地時間的分鐘數（0–1439）。 */
  nowMin: number;
}): boolean {
  const { latest } = ctx;
  const convo = latest.group ?? latest.sender;
  const offHoursMuted = shouldMuteOrgNotification(
    ctx.org,
    latest.group ? { orgGroup: ctx.orgGroups.has(latest.group) } : { senderContact: latest.sender },
    ctx.nowMin,
  );
  return shouldNotify(ctx.prefs, {
    event: latest.group ? "group" : "dm",
    masterOn: ctx.masterOn,
    windowHidden: true,
    offHoursMuted,
    convoMuted: ctx.muted.has(convo),
    mentionsMe: latest.mentionsMe,
  });
}

/**
 * 通知水位：同一個身分數到的則數**超過上次通知過的**才算新的（回 true 並推進水位）。
 * 背景連線被重建時會從 0 重數同一批訊息——沒有這道，每次重建都重跳一次通知。
 */
export function advanceNotified(marks: Record<string, number>, pubkey: string, count: number): boolean {
  if (count <= (marks[pubkey] ?? 0)) return false;
  marks[pubkey] = count;
  return true;
}
