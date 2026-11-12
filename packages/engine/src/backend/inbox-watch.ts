// 背景收件（ADR-0415 選項 B）：沒在用的身分只掛**一條收件匣訂閱**，數它離開之後的新訊息。
//
// ## 為什麼不直接再跑一個 RelayChatBackend
//
// 完整後端一收訊息就會：送已送達回條、推進 EK／名冊／裝置目錄狀態、寫儲存、發心跳。
// 背景身分做這些等於「同時在線」（ADR-0415 選項 A），而且會跟切回去時的正式後端搶同一份狀態。
//
// 所以這裡**只讀**：
// - 不發任何事件（沒有回條、沒有心跳 → 對聯絡人而言這個身分仍是離線）。
// - 不寫儲存（解開 Gift Wrap 只用金鑰，不動 EK 狀態）。
// - 訊息留在中繼上，切回這個身分時正式後端照常收、照常處理。
//
// 數的是「看得見的訊息」：rumor kind 14 的文字／檔案／群訊，扣掉回條、個人檔、行程、入職請求
// 這類搭 kind 14 便車的控制訊息（與 `RelayChatBackend.receiveDm` 的分流一致）。

import {
  KIND,
  TIMESTAMP_JITTER_SECONDS,
  buildAuthEvent,
  calendarEventOf,
  calendarRsvpOf,
  groupTarget,
  openWrapWithEks,
  parseOrgJoin,
  parseProfile,
  receiptOf,
  type NostrEvent,
  type PubkeyHex,
  type RecipientKeyLike,
  type Rumor,
  nsecDecode,
  pqKeyFromStored,
  type PqKeyPair,
  type SecretKey,
} from "@cinderous/core";
import type { StoredFsKey } from "../storage/types.js";
import type { CloseableRelayClient, RelayConnector } from "./relay-backend.js";

/**
 * 解封候選金鑰：前向保密的每把 EK（含後量子那半）＋身分金鑰（ADR-0245／0365）。
 * `RelayChatBackend` 與背景收件共用——兩邊各寫一份，下次加新機制時一定有一邊漏掉。
 */
export function fsRecipientKeys(
  keys: readonly StoredFsKey[],
  sk: SecretKey,
  pqOf: (key: StoredFsKey) => PqKeyPair | undefined = (k) => (k.pq ? pqKeyFromStored(k.pq) : undefined),
): RecipientKeyLike[] {
  const eks: RecipientKeyLike[] = keys.map((k) => {
    const pq = pqOf(k);
    return pq ? { sk: nsecDecode(k.nsec), pqSk: pq.sk } : nsecDecode(k.nsec);
  });
  return [...eks, sk];
}

export interface InboxWatchOptions {
  /** 這個（背景）身分的公鑰。 */
  self: PubkeyHex;
  /** 這個身分的私鑰：回應 NIP-42 AUTH、解 Gift Wrap。 */
  sk: SecretKey;
  /** 這個身分的收件匣所在中繼網址（分片模式＝自己的訊息片）；NIP-42 AUTH 的 relay 標籤要用它。 */
  url: string;
  /** 連到 {@link url} 的連線。 */
  connector: RelayConnector;
  /** 只數這個時間（unix 秒）之後送出的訊息＝離開這個身分的時間。 */
  sinceSec: number;
  /** 解封候選金鑰（前向保密的 EK＋身分金鑰；見 {@link fsRecipientKeys}）。 */
  keys: () => RecipientKeyLike[];
  /** 封鎖名單：不數。 */
  blocked?: ReadonlySet<string>;
  /**
   * 這個身分的聯絡人與已加入的群組。陌生人的訊息只進「訊息請求」、接受前不跳通知（ADR-0121）——
   * 背景收件也一樣：**只數聯絡人寄來的、與已加入群組裡的**。省略＝不過濾（只給測試用）。
   */
  known?: { contacts: ReadonlySet<string>; groups: ReadonlySet<string> };
  /** 新訊息數變了（累計值）。 */
  onCount: (count: number) => void;
}

/**
 * 這則解開的 rumor 算不算「一則新訊息」（純函式）。
 *
 * 自己別台裝置的副本、封鎖的人、離開前送出的、以及搭 kind 14 的控制訊息都不算。
 */
export function isCountableIncoming(
  sender: PubkeyHex,
  rumor: Rumor,
  self: PubkeyHex,
  sinceSec: number,
  blocked?: ReadonlySet<string>,
  known?: { contacts: ReadonlySet<string>; groups: ReadonlySet<string> },
): boolean {
  if (sender === self) return false;
  if (blocked?.has(sender)) return false;
  if (rumor.kind !== KIND.CHAT) return false;
  if (known) {
    const group = groupTarget(rumor);
    if (group ? !known.groups.has(group) : !known.contacts.has(sender)) return false; // 陌生人不數（ADR-0121）
  }
  if (rumor.created_at <= sinceSec) return false;
  if (receiptOf(rumor) || parseProfile(rumor) || calendarEventOf(rumor) || calendarRsvpOf(rumor) || parseOrgJoin(rumor)) {
    return false;
  }
  return true;
}

export class InboxWatcher {
  private readonly client: CloseableRelayClient;
  private readonly seen = new Set<string>();
  private stopped = false;

  constructor(private readonly opts: InboxWatchOptions) {
    const filters = [
      {
        kinds: [KIND.OFFLINE_DM_GIFT_WRAP],
        "#p": [opts.self],
        // 外層 created_at 被 NIP-59 隨機往前推最多 2 天 → 窗要多開 2 天，否則會漏（同 inboxSince）。
        since: opts.sinceSec - TIMESTAMP_JITTER_SECONDS,
      },
    ];
    this.client = opts.connector({
      onEvent: (_sub, event) => this.onEvent(event),
      authSigner: (challenge) => buildAuthEvent(challenge, opts.url, opts.sk),
      onAuthenticated: (client) => client.subscribe("inbox", filters),
    });
    this.client.subscribe("inbox", filters);
  }

  /** 目前數到的新訊息數。 */
  get count(): number {
    return this.seen.size;
  }

  stop(): void {
    this.stopped = true;
    this.client.close?.();
  }

  private onEvent(event: NostrEvent): void {
    if (this.stopped || event.kind !== KIND.OFFLINE_DM_GIFT_WRAP) return;
    let opened;
    try {
      opened = openWrapWithEks(event, this.opts.keys());
    } catch {
      return; // 解不開（不是給我的、或 EK 已回收）→ 不數；切回去時正式後端會再試
    }
    const { sender, rumor } = opened;
    if (this.seen.has(rumor.id)) return;
    if (!isCountableIncoming(sender, rumor, this.opts.self, this.opts.sinceSec, this.opts.blocked, this.opts.known)) return;
    this.seen.add(rumor.id);
    this.opts.onCount(this.seen.size);
  }
}
