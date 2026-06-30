import { verifyEvent, type NostrEvent } from "@nostr-buddy/core";
import { matchFilter } from "./filters.js";
import {
  parseClientMessage,
  type RelayFilter,
  type RelayMessage,
} from "./protocol.js";

const EPHEMERAL_MIN = 20000;
const EPHEMERAL_MAX = 29999;

/** NIP-01：20000–29999 為 Ephemeral，中繼站不得持久化。 */
export function isEphemeral(kind: number): boolean {
  return kind >= EPHEMERAL_MIN && kind <= EPHEMERAL_MAX;
}

/** 要送往某連線的一則訊息。 */
export interface Outbound {
  to: string;
  message: RelayMessage;
}

export interface RelayCoreOptions {
  /**
   * 持久化 sink（M2 接 D1）。Ephemeral 事件**絕不會**呼叫此函式，
   * 以保證上線狀態/心跳純記憶體轉發、不寫資料庫。
   */
  persist?: (event: NostrEvent) => void;
}

/**
 * 傳輸無關的中繼核心：管理各連線的訂閱、驗證事件並對符合的訂閱扇出。
 * 由 Worker / Durable Object 注入實際的 WebSocket 收發。
 */
export class RelayCore {
  /** connId -> (subId -> filters) */
  private readonly subs = new Map<string, Map<string, RelayFilter[]>>();

  constructor(private readonly opts: RelayCoreOptions = {}) {}

  connect(connId: string): void {
    if (!this.subs.has(connId)) this.subs.set(connId, new Map());
  }

  disconnect(connId: string): void {
    this.subs.delete(connId);
  }

  handle(connId: string, raw: string): Outbound[] {
    const msg = parseClientMessage(raw);
    switch (msg.type) {
      case "EVENT":
        return this.handleEvent(connId, msg.event);
      case "REQ": {
        this.connect(connId);
        this.subs.get(connId)?.set(msg.subId, msg.filters);
        // M1 無歷史事件儲存，直接回 EOSE。
        return [{ to: connId, message: ["EOSE", msg.subId] }];
      }
      case "CLOSE": {
        this.subs.get(connId)?.delete(msg.subId);
        return [{ to: connId, message: ["CLOSED", msg.subId, ""] }];
      }
      case "INVALID":
        return [{ to: connId, message: ["NOTICE", `invalid: ${msg.reason}`] }];
    }
  }

  private handleEvent(connId: string, event: NostrEvent): Outbound[] {
    if (!verifyEvent(event)) {
      return [{ to: connId, message: ["OK", event.id, false, "invalid: 簽章驗證失敗"] }];
    }

    // Ephemeral 純轉發、不寫 D1；其餘交由持久層（M2）。
    if (!isEphemeral(event.kind)) {
      this.opts.persist?.(event);
    }

    const out: Outbound[] = [{ to: connId, message: ["OK", event.id, true, ""] }];
    for (const [otherConn, bySub] of this.subs) {
      for (const [subId, filters] of bySub) {
        if (filters.some((f) => matchFilter(f, event))) {
          out.push({ to: otherConn, message: ["EVENT", subId, event] });
        }
      }
    }
    return out;
  }
}
