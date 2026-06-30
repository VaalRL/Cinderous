import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { SecretKey } from "./keys.js";
import { finalizeEvent } from "./sign.js";

export interface HeartbeatOptions {
  /** Unix 秒；省略時填入現在。 */
  created_at?: number;
  /** 可選狀態字串（如正在聆聽音樂）；省略時 content 為空。 */
  status?: string;
}

/** 建立一筆已簽章的 Kind 20000 心跳事件（Ephemeral）。 */
export function createHeartbeat(sk: SecretKey, opts: HeartbeatOptions = {}): NostrEvent {
  return finalizeEvent(
    {
      kind: KIND.HEARTBEAT,
      created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
      tags: [],
      content: opts.status ?? "",
    },
    sk,
  );
}
