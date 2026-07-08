// NIP-42 客戶端認證（AUTH）。開放中繼以此要求「先證明掌握某 pubkey，才准讀寫」，
// 關掉「第三方探測他人加密收件匣元資料」（ADR-0057）。此模組只管 AUTH 事件的
// 建構與解析，純函式可測；relay 端的挑戰/驗證/閘門在 `@cinder/relay`。

import type { NostrEvent } from "./event.js";
import type { SecretKey } from "./keys.js";
import { finalizeEvent } from "./sign.js";

/** NIP-42 客戶端認證事件的 kind。 */
export const AUTH_KIND = 22242;

/**
 * 建構 NIP-42 AUTH 回應事件（客戶端以私鑰簽章）。relay 發 `["AUTH", challenge]` 挑戰後，
 * 客戶端以此回 `["AUTH", event]`。`relayUrl` 填 `relay` tag、`challenge` 填 `challenge` tag。
 */
export function buildAuthEvent(challenge: string, relayUrl: string, sk: SecretKey): NostrEvent {
  return finalizeEvent(
    {
      kind: AUTH_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["relay", relayUrl],
        ["challenge", challenge],
      ],
      content: "",
    },
    sk,
  );
}

/** 取 AUTH 事件的 `challenge` tag 值；無則 undefined。 */
export function authChallengeOf(event: NostrEvent): string | undefined {
  return event.tags.find((t) => t[0] === "challenge")?.[1];
}
