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
import { DEFAULT_MAX_TTL_SECONDS, type MessageStoreOptions } from "./message-store.js";
import type { RelayCoreOptions } from "./relay-core.js";

/** 每收件人離線留言上限（防單一收件人塞爆免費額度；PRD §8）。 */
export const MAX_PER_RECIPIENT = 500;

/** 每連線訂閱數上限（ADR-0119）：客戶端合併後只用 1 個 REQ，16 已極寬鬆。 */
export const MAX_SUBSCRIPTIONS = 16;

/** 每 pubkey 每分鐘事件上限（ADR-0235 H1）。真實用量遠低於此（自適應心跳 60/300s）。 */
export const MAX_EVENTS_PER_MINUTE = 120;

/**
 * 每連線每分鐘**進站訊息**上限（ADR-0366 §容量）。超過即 NOTICE ＋ 關閉連線。
 *
 * 🔴 為什麼不能只有上面那一條：`MAX_EVENTS_PER_MINUTE` 只數 EVENT，而 Cloudflare 的
 * 計費單位是**進站訊息**。一組 `REQ` ＋ `CLOSE` 就是兩次請求，開了又關可以無限重複，
 * 完全不經過事件限速——健康探針正是這個形狀，實測下來它比整場對局還貴。
 *
 * 240 是「遠高於任何正常客戶端、又擋得住灌水」的一條線：必須**大於**
 * {@link MAX_EVENTS_PER_MINUTE}，否則發事件的人會先撞到這一條，
 * 那等於把事件上限偷偷改小（檔案分塊上傳就是連續的 EVENT）。此不變量由測試釘死。
 */
export const MAX_MESSAGES_PER_MINUTE = 240;

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
  maxMessagesPerMinute: MAX_MESSAGES_PER_MINUTE,
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

/**
 * PoW 難度上限（ADR-0366 P2 #11）。
 *
 * 期望嘗試次數是 `2^difficulty`，所以這個數字實質上是「還挖得動嗎」的界線：
 * 2^32 已經是分鐘級，再往上設就不是防濫用而是拒絕服務——而且是**對誠實使用者**的。
 */
export const MAX_POW_DIFFICULTY = 32;

/**
 * 由環境變數算出 PoW 難度（ADR-0366 P2 #11）。未設／壞值／負數 → 0（不要求）。
 */
export function powFrom(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_POW_DIFFICULTY);
}

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
 * 本車道的 PoW 難度（ADR-0366 P2 #11）。
 *
 * 🔴 **嚴格平面恆為 0，而且不是設定，是事實**：本專案沒有任何挖礦實作，
 * 客戶端發不出帶 PoW 的事件（ARCHITECTURE §5：「啟用會讓現有安裝無法發訊息」）。
 * core 的 `minePow` 是這一批才加的，現有安裝不會有它。
 *
 * 🔴 **第三方車道預設也是 0**，原因與原本的預期不同：ADR-0366 §決策 7 寫「第三方客戶端
 * 現在才在寫 ⇒ 第一天就要求即無相容性包袱」——但實際查下來，《元素使》的
 * `claude/project-initialization-status-sqvfqh` **已經有能跑的 `packages/nostr`**，
 * 而它發布的可尋址牌組事件是持久化事件 ⇒ 今天打開就會弄壞一個正在運作的客戶端。
 * ⇒ 旋鈕做好、預設關閉，由 `APP_LANE_POW` 在下游備妥挖礦後開啟。
 *
 * ⚠ 打開之前要知道它**打不到**哪裡：PoW 只檢查**持久化**事件（`relay-core` 的
 * `if (!isEphemeral(kind))`）。大廳心跳與信令是 ephemeral ⇒ 不受影響——這正好是對的
 * （它們不佔儲存），但也意味著 PoW 擋不住大廳灌水，那條要靠 IP 限速。
 */
export function powForLane(profile: RelayProfile, appLanePowRaw: string | undefined): number {
  return profile === "app" ? powFrom(appLanePowRaw) : 0;
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
 * 由 `MAX_MESSAGES_PER_MINUTE` 原始字串算出每連線訊息上限（node 自架可覆寫）。
 * 未設／壞值 → 預設 {@link MAX_MESSAGES_PER_MINUTE}；<1 視為關閉（undefined）。
 *
 * 🔴 **永遠不低於事件上限的兩倍**：自架者把 `MAX_EVENTS_PER_MINUTE` 調高之後，
 * 若訊息上限還夾在 240，他調的那個數字就是假的——而症狀是「事件被擋，
 * 但訊息說 rate-limited」，兩種完全不同的診斷。
 */
export function messagesPerMinuteFrom(
  raw: string | undefined,
  eventsPerMinute: number | undefined,
): number | undefined {
  const n = raw === undefined ? NaN : Number(raw);
  const base = !Number.isFinite(n) ? MAX_MESSAGES_PER_MINUTE : n >= 1 ? Math.floor(n) : undefined;
  if (base === undefined) return undefined;
  return eventsPerMinute === undefined ? base : Math.max(base, eventsPerMinute * 2);
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
 * **公用**車道（不在 `APP_LANES` 名單上）的可尋址位址配額（ADR-0366 §裁示）。
 *
 * 錨點對所有車道開放，所以這顆共用分片上跑的是我們**不知道其形狀**的應用。
 * 64 是替本專案四款遊戲的用法（多份牌組、多個 epoch 快照）量身訂的數字，
 * 沒有理由預設送給不認識的應用；16 對一般可尋址用途（名單、設定、個人檔案）
 * 綽綽有餘，而且把「一個作者塞爆共用分片」的上界壓低四倍。
 *
 * ⚠ 這不是門禁也不是防禦：車道 id 自報，陌生人把自己叫做 `lwd` 就會落進那顆 DO
 * 並拿到 64。它是**誠實的預設值**，真正的成本界線是升級限速與每連線訊息上限。
 */
export const PUBLIC_LANE_ADDRESSABLE_PER_AUTHOR = 16;

/**
 * 車道上單顆可尋址事件的位元組上限（ADR-0366 §容量二）。
 *
 * 預設的 256KB 是為 ADR-0071 的**加密雲端快照**訂的；車道上的東西小得多
 * （《元素使》一份牌組約 2KB、世界快照數十 KB）。而「單顆上限 × 每連線訊息上限」
 * 就是**一條連線每分鐘能塞進多少位元組**——256KB × 240 ≈ 60MB/分，換成 32KB
 * 立刻降為 1/8。這是目前最便宜、最有效的一道。
 *
 * ⚠ 車道日後若真要放大型快照，改這個數字之前要先重算上面那個乘積。
 */
export const APP_ADDRESSABLE_MAX_BYTES = 32 * 1024;

/**
 * **每個作者**的可尋址總位元組上限（跨所有 kind；ADR-0366 §容量二）。
 *
 * 🔴 為什麼兩個平面都要有：位址配額的計數範圍是 (pubkey, **kind**)，而 kind 區間有一萬個
 * 且由發送方自選 ⇒ 沒有這一條，「每人每 kind N 個」實際上是「每人 N 萬個」，
 * 單一作者的可尋址儲存是**無界**的。嚴格平面同樣如此（NIP-42 擋不住——金鑰不用錢）。
 *
 * 數字的根據：
 * - 嚴格平面現有最大用途是 ADR-0071 的雲端快照，5 台裝置 × 256KB ＝ 1.25MB ⇒ 8MB 非常寬鬆。
 * - 車道（已知租戶）64 × 32KB ＝ 2MB／kind ⇒ 8MB 容得下牌組＋多個 epoch 的世界快照。
 * - 公用車道 16 × 32KB ＝ 512KB／kind ⇒ 2MB 對一般可尋址用途足夠。
 *
 * ⚠ **它擋不住換金鑰的人**（pubkey 不用錢，鑄一把是微秒級的事）。它擋的是「單一身分
 * 無限累積」；速率那一側由每連線訊息上限 × 單顆上限決定。要讓**總量**真的有界，
 * 還需要一道「整顆 DO 的可尋址容量天花板＋淘汰」——尚未實作，見 ADR-0366 §容量二。
 */
export const STRICT_ADDRESSABLE_BYTES_PER_AUTHOR = 8 * 1024 * 1024;
export const APP_ADDRESSABLE_BYTES_PER_AUTHOR = 8 * 1024 * 1024;
export const PUBLIC_LANE_ADDRESSABLE_BYTES_PER_AUTHOR = 2 * 1024 * 1024;

/**
 * **公用分片**的保存期（秒；ADR-0367 §決策 1）：見習保存。
 *
 * 🔴 為什麼是「保存」而不是「進門等待」：等待對攻擊者免費且可平行（開一千個身分
 * 一起等就抵銷了），要讓等待構成成本必須數得出「他」是誰——而身分不用錢。
 * 把等待加在**保存**那一端，換金鑰就再也沒有用：每一把新金鑰都從頭蹲一次。
 *
 * 穩態儲存量因此是 `寫入速率 × 見習期` 而不是 `寫入速率 × 30 天`：
 * 以車道單顆 {@link APP_ADDRESSABLE_MAX_BYTES} × 每連線 {@link MAX_MESSAGES_PER_MINUTE}
 * 計，一條連線的穩態水位約 900MB 而不是數百 GB。
 *
 * 🔵 **只套在公用分片**：名單上的車道（我們知道其用法）與嚴格平面（ADR-0071 的
 * 「活躍即永久」契約）一個字都不動。這種規則設錯的症狀是「安靜地掉資料」，
 * 爆炸半徑因此刻意只落在陌生應用的資料上。
 *
 * ⚠ 代價：陌生應用「發完就離線」的資料會在兩小時後消失（活躍即刷新——
 * `putAddressable` 每次更新都重算到期時間）。這必須讓對方知道 ⇒ NIP-11 的
 * `retention` 與 `cinder_addressable_ttl_sec` 會如實回報這個值。
 */
export const PUBLIC_LANE_RETENTION_SECONDS = 2 * 60 * 60;

/**
 * **整顆 DO** 的可尋址容量天花板（ADR-0367 §決策 2）。
 *
 * 見習保存讓水位不會一直漲，天花板保證**極端情況也不撐爆**——兩者互補：
 * 前者管「平均」，後者管「最壞」。超過時車道淘汰**最快到期**者，
 * 而見習中的資料天然排在最前面（§決策 1 的直接結果，不是巧合）。
 *
 * 🔴 **嚴格平面只拒收、不淘汰**（{@link storeOptions} 只對車道打開淘汰）：
 * 那裡的資料是使用者的加密雲端快照，ADR-0071 承諾「活躍即永久」——
 * 刪別人的備份不可逆，而拒收看得見（回 `OK false`，營運者查得到）。
 *
 * ⚠ **這個數字待實測校準**（同 ADR-0006 對容量的處理）：它必須夠大才不會擋到正常用量
 * （嚴格平面 128MB ≈ 100 位使用者的雲端快照），又必須小到單顆 DO 不會撞上平台上限。
 * 帳號層級的總量是「天花板 × DO 數」，ADR-0006 的免費額度天花板不因此解除。
 */
export const DO_ADDRESSABLE_MAX_BYTES = 128 * 1024 * 1024;

/**
 * 站方的已知租戶名單（`APP_LANES`，逗號分隔；ADR-0366 §裁示）。
 *
 * 🔴 **它不是白名單**：不在名單上的車道照常服務——錨點同時是公用 relay。
 * 名單決定的是「這條車道有沒有自己的 DO」，也因此決定它的可尋址配額。
 * 未設／空字串＝沒有已知租戶，所有車道共用雜湊分片（車道剛上線時的行為）。
 *
 * ⚠ **把一條車道加進名單或移出名單，等於換一顆 DO**：它先前存在舊 DO 裡的
 * 可尋址事件與離線留言不會跟著搬，會留在原處直到 TTL 到期。名單要在上線前定好，
 * 之後的變更請當成該車道的一次冷啟動。
 */
export function knownLanes(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id.length > 0),
  );
}

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
  /** 這顆 DO 服務的是名單上的已知租戶嗎（ADR-0366 §裁示）；預設否＝公用配額。 */
  knownLane = false,
): MessageStoreOptions {
  const configured = ttlSecondsFromDays(maxTtlDaysRaw);
  const publicLane = profile === "app" && !knownLane;
  // 公用分片取「站方上限」與「見習期」之中比較短的那個——站方上限恆為權威（ADR-0160）。
  const ttl = publicLane
    ? Math.min(configured ?? DEFAULT_MAX_TTL_SECONDS, PUBLIC_LANE_RETENTION_SECONDS)
    : configured;
  const addressable = knownLane ? APP_ADDRESSABLE_PER_AUTHOR : PUBLIC_LANE_ADDRESSABLE_PER_AUTHOR;
  const bytesPerAuthor =
    profile !== "app"
      ? STRICT_ADDRESSABLE_BYTES_PER_AUTHOR
      : knownLane
        ? APP_ADDRESSABLE_BYTES_PER_AUTHOR
        : PUBLIC_LANE_ADDRESSABLE_BYTES_PER_AUTHOR;
  return {
    maxPerRecipient: MAX_PER_RECIPIENT,
    addressableBytesPerAuthor: bytesPerAuthor,
    addressableMaxTotalBytes: DO_ADDRESSABLE_MAX_BYTES,
    // 車道淘汰、嚴格平面拒收（ADR-0367 §決策 2）：刪別人的加密備份不可逆。
    ...(profile === "app" ? { addressableCeilingEvicts: true } : {}),
    ...(ttl !== undefined ? { maxTtlSeconds: ttl } : {}),
    ...(profile === "app"
      ? { addressablePerAuthor: addressable, addressableMaxBytes: APP_ADDRESSABLE_MAX_BYTES }
      : {}),
    ...(publicLane ? { addressableTtlSeconds: PUBLIC_LANE_RETENTION_SECONDS } : {}),
  };
}
