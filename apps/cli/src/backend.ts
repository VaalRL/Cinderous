// CLI 的無頭後端（ADR-0098／0404）。從 main.ts 抽出來，好在記憶體網路上測路由。
import {
  ANCHOR_RELAYS,
  RelayChatBackend,
  webSocketConnector,
  type LocalStorage,
  type MemoryStorage,
  type RelayConnector,
} from "@cinderous/engine";

export interface CliBackendDeps {
  /** 測試注入記憶體網路；預設真的 WebSocket。 */
  connectorFor?: (url: string) => RelayConnector;
  /** 預設 App 用的那份錨點清單。 */
  anchors?: string[];
}

export function createCliBackend(
  storage: MemoryStorage | LocalStorage,
  nsec: string,
  relay: string,
  name: string,
  deps: CliBackendDeps = {},
): RelayChatBackend {
  const connectorFor = deps.connectorFor ?? webSocketConnector;
  // 🔴 路由設定照 App 個人身分（apps/desktop buildBackend）：App 預設開分片（ADR-0241），收件匣在
  // 錨點的訊息片上；兩座錨點都列，對方在另一座時才寄得到（ADR-0383）。少了這兩項，CLI 寄出顯示 sent，
  // App 卻永遠收不到——CLI 對 CLI 測不出來，因為兩邊同樣沒開分片。
  return new RelayChatBackend(storage, connectorFor(relay), name, {
    relayUrl: relay,
    connectorFor,
    shardingBase: relay,
    anchors: deps.anchors ?? ANCHOR_RELAYS,
    nsecOverride: nsec,
    ...(typeof __APP_VERSION__ === "string" ? { appVersion: __APP_VERSION__ } : {}), // ADR-0397：裝置報告
  });
}
