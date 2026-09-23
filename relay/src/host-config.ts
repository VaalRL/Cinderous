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
 * 第三方應用車道的政策（ADR-0366 §決策 5／7）。
 *
 * 與嚴格平面共用整組 {@link ABUSE_GUARD}——**放寬的只有訂閱形狀與認證**，
 * 大小、tag 數、時鐘窗、訂閱數全部原樣。
 *
 * 🔴 `requireAuth: false` 的代價要講清楚：`RelayCore` 的速率桶在無 AUTH 時會退回
 * `event.pubkey`（見 `relay-core.ts` 的註解），而那是發送方自選的 ⇒ **per-pubkey 限速
 * 在這條車道上幾乎沒有牙**。誠實地說，開著 AUTH 也沒好多少（AUTH 只證明你掌握某把私鑰）。
 * 真正要擋的手段是綁「比較貴的東西」：IP 為鍵的 CF rate limit（`/turn` 已有先例）
 * 與 NIP-13 PoW——兩者都列在 ADR-0366 的後續行動，**不在本批**。
 *
 * 為什麼不乾脆要求 AUTH：下游其中一個客戶端的訊息 switch 根本不處理 `["AUTH", …]`
 * （`default: return;`），要求認證等於把它永久鎖在門外。
 */
export const APP_LANE_GUARD = {
  ...ABUSE_GUARD,
  publicLane: true,
  requireAuth: false,
} as const satisfies Partial<RelayCoreOptions>;

/** 路由出來的政策代號（`shard.ts` 的 `RelayRoute.profile`）。 */
export type RelayProfile = "strict" | "app";

/**
 * 政策代號 → `RelayCore` 設定片段（ADR-0366）。**兩座宿主的單一真實來源。**
 *
 * 這個函式存在的理由與 `ABUSE_GUARD` 相同（見本檔開頭）：政策若由 worker 與 node-relay
 * 各自拼一份，遲早會漂移成「路由到寬鬆 DO 卻套了嚴格政策」——而那只有在產線才看得出來。
 */
export function guardFor(profile: RelayProfile): Partial<RelayCoreOptions> {
  return profile === "app" ? { ...APP_LANE_GUARD } : { requireAuth: true, ...ABUSE_GUARD };
}

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

/**
 * 第三方車道的可尋址位址配額（ADR-0366 P1 #7）。
 *
 * 預設的 5 是 ADR-0071 為「每人 5 台裝置」訂的，那描述的是**裝置數**——第三方車道上
 * 一位玩家可能同時有多份牌組與多個 epoch 的世界快照，套 5 會在第 6 份就被拒。
 *
 * ⚠ 64 是**有根據的猜測，待實測校準**（同 ADR-0006 對容量的處理方式）：它必須夠大
 * 才擋不到正常用法，又必須有界才擋得住「一個作者塞爆這顆 DO」。最壞情況是
 * 64 × {@link ADDRESSABLE_MAX_BYTES}（256KB）＝ 16MB／作者／kind——實際 payload
 * 遠小於此（一份牌組約 2KB），但這個數字該被量過再定案。
 */
export const APP_ADDRESSABLE_PER_AUTHOR = 64;

/**
 * store 選項（每收件人上限固定；TTL 由 env 決定；可尋址配額依車道，ADR-0366 P1 #7）。
 *
 * 🔵 可尋址 **TTL 不隨車道改變**（維持 30 天）：`putAddressable` 每次更新都會刷新到期時間，
 * 所以「活躍即永久」本來就成立，遊戲不需要更長的預設。真要拉長的是**自架的世界站**
 * （挑戰窗長度），那條路走 store 選項本身即可（P1 #8 把旋鈕做出來了），不需要動預設。
 */
export function storeOptions(
  maxTtlDaysRaw: string | undefined,
  profile: RelayProfile = "strict",
): MessageStoreOptions {
  const ttl = ttlSecondsFromDays(maxTtlDaysRaw);
  return {
    maxPerRecipient: MAX_PER_RECIPIENT,
    ...(ttl !== undefined ? { maxTtlSeconds: ttl } : {}),
    ...(profile === "app" ? { addressablePerAuthor: APP_ADDRESSABLE_PER_AUTHOR } : {}),
  };
}
