import type { NostrEvent } from "@nostr-buddy/core";

/**
 * Relay 端支援的訂閱 filter（NIP-01 子集，含 `#<tag>` 標籤 filter）。
 *
 * 契約同步：與 core 端的 `Filter`（`packages/core/src/presence.ts`）形狀相同，
 * 修改欄位時兩處須同步更新。
 */
export interface RelayFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  /** 標籤 filter，如 `#p`（收件人）、`#e`（引用事件）。 */
  [tag: `#${string}`]: string[] | undefined;
}

export type ClientMessage =
  | { type: "EVENT"; event: NostrEvent }
  | { type: "REQ"; subId: string; filters: RelayFilter[] }
  | { type: "CLOSE"; subId: string }
  | { type: "INVALID"; reason: string };

/** Relay → Client 訊息（NIP-01）。 */
export type RelayMessage =
  | ["EVENT", string, NostrEvent]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["CLOSED", string, string]
  | ["NOTICE", string];

const invalid = (reason: string): ClientMessage => ({ type: "INVALID", reason });

/** 解析客戶端送來的原始字串為結構化訊息；無法解析時回傳 INVALID。 */
export function parseClientMessage(raw: string): ClientMessage {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return invalid("invalid json");
  }
  if (!Array.isArray(arr) || arr.length === 0) return invalid("not a non-empty array");

  switch (arr[0]) {
    case "EVENT": {
      const event = arr[1];
      if (typeof event !== "object" || event === null) return invalid("missing event");
      return { type: "EVENT", event: event as NostrEvent };
    }
    case "REQ": {
      const subId = arr[1];
      if (typeof subId !== "string") return invalid("missing subscription id");
      const rest = arr.slice(2) as RelayFilter[];
      return { type: "REQ", subId, filters: rest.length > 0 ? rest : [{}] };
    }
    case "CLOSE": {
      const subId = arr[1];
      if (typeof subId !== "string") return invalid("missing subscription id");
      return { type: "CLOSE", subId };
    }
    default:
      return invalid(`unknown message type: ${String(arr[0])}`);
  }
}
