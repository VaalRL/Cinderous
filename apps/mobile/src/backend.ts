// 行動端通訊後端選擇（ADR-0086）：真實 relay vs 示範。
// 真實 relay 走與桌面**同一套** RelayChatBackend＋webSocketConnector＋LocalStorage（重用 @cinder/engine）：
//   - 身分以 nsecOverride 注入（私鑰不落 localStorage；聯絡人/訊息仍持久化於 localStorage 命名空間＝pubkey）。
//   - anchors 帶入該 relay 供自動選座/回退。
// 正式行動版把 LocalStorage 換成 RN 安全儲存即可（同一 AppStorage 介面，見 ADR-0053/D2）。
import {
  ANCHOR_RELAYS,
  type AppStorage,
  type ChatBackend,
  type CloudSyncMode,
  getDeviceId,
  LocalStorage,
  MAINTAINER_PUBKEY,
  RelayChatBackend,
  webSocketConnector,
} from "@cinder/engine";
import type { MobileIdentity } from "./auth.js";
import { createDemoChat } from "./chat.js";

/** 預設生產中繼站（可於 UI 覆寫）。 */
export const DEFAULT_RELAY = "wss://cinder-relay.whoami885.workers.dev";

/** 建立後端的額外選項（ADR-0100 行動端補齊）。 */
export interface MobileBackendOptions {
  /** 與 App 共用的儲存（ADR-0094：保留上限/導出需同一份）。 */
  store?: AppStorage | undefined;
  /** 加密雲端備份模式（ADR-0071）；`off`／未提供＝不發佈快照。 */
  cloudSync?: CloudSyncMode | undefined;
}

/**
 * 以真實 relay 建立通訊後端（同帳號、持久化聯絡人/訊息）。
 *
 * ADR-0100：補上桌面早有、行動端缺的三項——
 *  - **錨點與簽章清單**：`anchors: ANCHOR_RELAYS` ＋ `maintainerPubkey`（過去只有 `[relayUrl]`
 *    一座、也不學帶內清單 → 該座掛掉就等於斷線、也吃不到自動改道/退役遷移）。
 *  - **多中繼路由**：`connectorFor` 讓引擎能對聯絡人的 relay hint 另開連線（ADR-0034）。
 *  - **加密雲端備份**：`cloudSync`（ADR-0071 換機還原）。
 */
export function createRelayChat(
  identity: MobileIdentity,
  relayUrl: string,
  opts: MobileBackendOptions = {},
): ChatBackend {
  const cloud =
    opts.cloudSync && opts.cloudSync !== "off"
      ? { cloudSync: { mode: opts.cloudSync, deviceId: getDeviceId() } }
      : {};
  return new RelayChatBackend(
    opts.store ?? new LocalStorage(identity.pubkey),
    webSocketConnector(relayUrl),
    identity.name,
    {
      relayUrl,
      connectorFor: webSocketConnector,
      // 錨點恆連保底：不再只綁使用者當下那一座（去重，避免同座重複）。
      anchors: [...new Set([relayUrl, ...ANCHOR_RELAYS])],
      ...(MAINTAINER_PUBKEY ? { maintainerPubkey: MAINTAINER_PUBKEY } : {}),
      ...cloud,
      nsecOverride: identity.nsec,
    },
  );
}

/** 依設定選後端：有 relayUrl＝真實 relay；否則示範後端（記憶體 relay＋機器人）。 */
export function createBackend(
  identity: MobileIdentity,
  relayUrl: string | null,
  opts: MobileBackendOptions = {},
): ChatBackend {
  return relayUrl ? createRelayChat(identity, relayUrl, opts) : createDemoChat(identity.name);
}
