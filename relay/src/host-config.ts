// 宿主組裝設定的**單一真實來源**（ADR-0235 H1 後續）。
//
// ## 為什麼這個檔案存在
//
// `worker.ts`（Cloudflare）與 `node-relay.ts`（自架）是兩個獨立的宿主，卻必須用**完全相同**
// 的濫用防護參數把 `RelayCore` 組起來。H1 的教訓正是「組裝層沒人測」——防護在 core 裡寫對了、
// 也測了，但 worker 從未把 `maxClockSkewSec` 傳進去，於是 `seenIds` 永遠是空的、零重放防護。
//
// 兩個宿主各自手抄一份常數 ＝ 隨時可能悄悄漂移：改了 worker 卻忘了 node，某座中繼就少一道防線。
// 把常數與衍生邏輯收斂到這裡、並在 `host-config.test.ts` 釘死不變量（尤其「過去窗必須大於
// NIP-59 抖動窗」），兩座宿主就不可能各走各的。

import { TIMESTAMP_JITTER_SECONDS } from "@cinderous/core";
import type { MessageStoreOptions } from "./message-store.js";
import type { RelayCoreOptions } from "./relay-core.js";

/** 每收件人離線留言上限（防單一收件人塞爆免費額度；PRD §8）。 */
export const MAX_PER_RECIPIENT = 500;

/** 每連線訂閱數上限（ADR-0119）：客戶端合併後只用 1 個 REQ，16 已極寬鬆。 */
export const MAX_SUBSCRIPTIONS = 16;

/** 每 pubkey 每分鐘事件上限（ADR-0235 H1）。真實用量遠低於此（自適應心跳 60/300s）。 */
export const MAX_EVENTS_PER_MINUTE = 120;

/** AUTH 事件最大年齡（秒；ADR-0235 H2）：NIP-42 建議，限制側錄簽名的可用時間。 */
export const AUTH_MAX_AGE_SEC = 600;

/** 未來方向時鐘容忍（秒）：沒有合法事件是未來的，只留客戶端時鐘誤差。 */
export const MAX_FUTURE_SKEW_SEC = 15 * 60;

/**
 * 過去方向時鐘容忍（秒）。**必須大於 {@link TIMESTAMP_JITTER_SECONDS}**——NIP-59 刻意把外層
 * `created_at` 往前推最多 2 天以免中繼從時序關聯出社交圖譜，設小了會擋掉幾乎每一則 Gift Wrap。
 * 這條不變量由 `host-config.test.ts` 釘死。
 */
export const MAX_PAST_SKEW_SEC = TIMESTAMP_JITTER_SECONDS + 60 * 60;

/**
 * 重放去重窗（秒）：只快取近期事件的 id。封裝事件不需要（收件端以 rumor.id 去重），
 * 真正要擋的是裸心跳（kind 20000）被重放來偽造「某人在線」。
 */
export const REPLAY_WINDOW_SEC = 60 * 60;

/** TTL 上界（天）：clamp 防 `MAX_TTL_DAYS=99999` 這類手誤產生實質無界保留（ADR-0160）。 */
export const TTL_CAP_DAYS = 3650;

/**
 * 兩座宿主共用的濫用防護 `RelayCoreOptions` 片段（ADR-0235 H1）。
 * `store`／`requireAuth`／`acceptFileEvents` 由各宿主自行補上（來源不同）。
 */
export const ABUSE_GUARD = {
  maxSubscriptions: MAX_SUBSCRIPTIONS,
  authMaxAgeSec: AUTH_MAX_AGE_SEC,
  maxEventsPerMinute: MAX_EVENTS_PER_MINUTE,
  maxFutureSkewSec: MAX_FUTURE_SKEW_SEC,
  maxPastSkewSec: MAX_PAST_SKEW_SEC,
  replayWindowSec: REPLAY_WINDOW_SEC,
} as const satisfies Partial<RelayCoreOptions>;

/**
 * 由 `MAX_TTL_DAYS` 原始字串算出 store 的 `maxTtlSeconds`（ADR-0160）。
 * 未設／壞值／<1 → undefined（＝store 用預設 7 天）；否則 clamp 到 {@link TTL_CAP_DAYS}。
 */
export function ttlSecondsFromDays(raw: string | undefined): number | undefined {
  const days = Math.min(Number(raw ?? 0), TTL_CAP_DAYS);
  if (!Number.isFinite(days) || days < 1) return undefined;
  return Math.floor(days) * 86_400;
}

/** 由 `MAX_FILE_MB` 原始字串判斷是否接受檔案塊（ADR-0162）：≥1 才收。 */
export function acceptFileEvents(raw: string | undefined): boolean {
  const mb = Number(raw ?? 0);
  return Number.isFinite(mb) && mb >= 1;
}

/**
 * 由 `MAX_EVENTS_PER_MINUTE` 原始字串算出速率上限（node 自架可覆寫）。
 * 未設／壞值 → 預設 {@link MAX_EVENTS_PER_MINUTE}；<1 視為關閉（undefined）。
 */
export function eventsPerMinuteFrom(raw: string | undefined): number | undefined {
  if (raw === undefined) return MAX_EVENTS_PER_MINUTE;
  const n = Number(raw);
  if (!Number.isFinite(n)) return MAX_EVENTS_PER_MINUTE;
  return n >= 1 ? Math.floor(n) : undefined;
}

/**
 * 正規化「本次連線打到的主機」（ADR-0235 H2）：AUTH 的 `relay` tag 必須指向它。
 *
 * 接受單一主機或 `X-Forwarded-Host` 的逗號串（反向代理會疊加）——取**第一個**、小寫、去空白。
 * 空／undefined 回 undefined（＝不強制 relay tag 檢查，自架/測試維持原行為）。
 */
export function firstHost(raw: string | undefined): string | undefined {
  const first = raw?.split(",")[0]?.trim().toLowerCase();
  return first ? first : undefined;
}

/** store 選項（每收件人上限固定；TTL 由 env 決定）。 */
export function storeOptions(maxTtlDaysRaw: string | undefined): MessageStoreOptions {
  const ttl = ttlSecondsFromDays(maxTtlDaysRaw);
  return { maxPerRecipient: MAX_PER_RECIPIENT, ...(ttl !== undefined ? { maxTtlSeconds: ttl } : {}) };
}
