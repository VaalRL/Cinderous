import type { NostrEvent } from "./event.js";
import type { Filter } from "./presence.js";

/** 實際的網路通道（瀏覽器 WebSocket / Tauri / 測試替身皆可注入）。 */
export interface RelayTransport {
  send(data: string): void;
}

export interface RelayClientHandlers {
  onEvent?: (subId: string, event: NostrEvent) => void;
  onEose?: (subId: string) => void;
  onOk?: (eventId: string, accepted: boolean, message: string) => void;
  onNotice?: (message: string) => void;
  /**
   * NIP-42 AUTH（ADR-0057）：收到 relay 的 `["AUTH", challenge]` 挑戰時，回傳簽好的
   * 認證事件（kind 22242）；client 會自動送出並在認證成功後呼叫 {@link onAuthenticated}。
   * 未提供＝不回應挑戰（開放 relay 無挑戰時無影響）。
   */
  authSigner?: (challenge: string) => NostrEvent;
  /**
   * AUTH 成功後觸發，帶回本 client 供上層在認證後重掛訂閱（解「訂閱早於認證」的順序問題）。
   * 傳回 client 而非依賴外部參照，避免同步認證時外部尚未指派完成。
   */
  onAuthenticated?: (client: RelayClient) => void;
}

/**
 * 與平台無關的 Nostr relay 客戶端：負責序列化送出與解析分派。
 * 由宿主持有實際 WebSocket，在收到訊息時呼叫 {@link RelayClient.receive}。
 */
export class RelayClient {
  /** 已送出、待 relay OK 的 NIP-42 AUTH 事件 id（用於辨識 AUTH 的 OK）。 */
  private pendingAuthId: string | undefined;

  constructor(
    private readonly transport: RelayTransport,
    private readonly handlers: RelayClientHandlers = {},
  ) {}

  /** 發布事件至中繼站。 */
  publish(event: NostrEvent): void {
    this.transport.send(JSON.stringify(["EVENT", event]));
  }

  /** 以一組 filter 建立訂閱。 */
  subscribe(subId: string, filters: Filter[]): void {
    this.transport.send(JSON.stringify(["REQ", subId, ...filters]));
  }

  /** 關閉訂閱。 */
  unsubscribe(subId: string): void {
    this.transport.send(JSON.stringify(["CLOSE", subId]));
  }

  /** 餵入自中繼站收到的原始訊息字串並分派。非法訊息將被忽略。 */
  receive(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;

    switch (msg[0]) {
      case "EVENT":
        if (typeof msg[1] === "string" && msg[2]) {
          this.handlers.onEvent?.(msg[1], msg[2] as NostrEvent);
        }
        return;
      case "EOSE":
        if (typeof msg[1] === "string") this.handlers.onEose?.(msg[1]);
        return;
      case "OK":
        if (typeof msg[1] === "string") {
          const id = msg[1];
          const accepted = Boolean(msg[2]);
          if (id === this.pendingAuthId) {
            // 這是 NIP-42 AUTH 事件的 OK：不當一般發布回應，成功則觸發 onAuthenticated。
            this.pendingAuthId = undefined;
            if (accepted) this.handlers.onAuthenticated?.(this);
          } else {
            this.handlers.onOk?.(id, accepted, String(msg[3] ?? ""));
          }
        }
        return;
      case "NOTICE":
        if (typeof msg[1] === "string") this.handlers.onNotice?.(msg[1]);
        return;
      case "AUTH":
        // NIP-42：relay 發挑戰 → 以 authSigner 簽 kind 22242 回應（ADR-0057）。
        if (typeof msg[1] === "string" && this.handlers.authSigner) {
          const authEvent = this.handlers.authSigner(msg[1]);
          this.pendingAuthId = authEvent.id;
          this.transport.send(JSON.stringify(["AUTH", authEvent]));
        }
        return;
      default:
        return;
    }
  }
}
