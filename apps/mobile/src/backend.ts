// 行動端通訊後端選擇（ADR-0086）：真實 relay vs 示範。
// 真實 relay 走與桌面**同一套** RelayChatBackend＋webSocketConnector＋LocalStorage（重用 @cinder/engine）：
//   - 身分以 nsecOverride 注入（私鑰不落 localStorage；聯絡人/訊息仍持久化於 localStorage 命名空間＝pubkey）。
//   - anchors 帶入該 relay 供自動選座/回退。
// 正式行動版把 LocalStorage 換成 RN 安全儲存即可（同一 AppStorage 介面，見 ADR-0053/D2）。
import { type ChatBackend, LocalStorage, RelayChatBackend, webSocketConnector } from "@cinder/engine";
import type { MobileIdentity } from "./auth.js";
import { createDemoChat } from "./chat.js";

/** 預設生產中繼站（可於 UI 覆寫）。 */
export const DEFAULT_RELAY = "wss://cinder-relay.whoami885.workers.dev";

/** 以真實 relay 建立通訊後端（同帳號、localStorage 持久化聯絡人/訊息）。 */
export function createRelayChat(identity: MobileIdentity, relayUrl: string): ChatBackend {
  const store = new LocalStorage(identity.pubkey);
  return new RelayChatBackend(store, webSocketConnector(relayUrl), identity.name, {
    relayUrl,
    connectorFor: webSocketConnector,
    anchors: [relayUrl],
    nsecOverride: identity.nsec,
  });
}

/** 依設定選後端：有 relayUrl＝真實 relay；否則示範後端（記憶體 relay＋機器人）。 */
export function createBackend(identity: MobileIdentity, relayUrl: string | null): ChatBackend {
  return relayUrl ? createRelayChat(identity, relayUrl) : createDemoChat(identity.name);
}
