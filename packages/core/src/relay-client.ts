import type { NostrEvent } from "./event.js";
import type { Filter } from "./presence.js";

// 關閉碼分類的唯一來源在 Cinderous SDK（SDK ADR 0038 P0-C、0108）：1013＝這座暫時不能用（ADR-0395）
export { classifyRelayClose } from "@cinderous/client/protocol";
// 真實網路的連線（重連退避、NIP-42、認證前被拒的重送、補訂閱、拒收分類）由 SDK 的連線池負責（ADR-0398）；
// 下面的 RelayClient 只剩記憶體測試網路與示範頁在用。
export { RelayPool, type RelayRejection } from "@cinderous/client";

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

/** 認證前送出、等 OK 的事件最多記幾顆（ADR-0385）。 */
const PRE_AUTH_MAX = 200;

/**
 * 與平台無關的 Nostr relay 客戶端：負責序列化送出與解析分派。
 * 由宿主持有實際 WebSocket，在收到訊息時呼叫 {@link RelayClient.receive}。
 */
export class RelayClient {
  /** 已送出、待 relay OK 的 NIP-42 AUTH 事件 id（用於辨識 AUTH 的 OK）。 */
  private pendingAuthId: string | undefined;
  /** 這條連線認證過了沒（ADR-0385）；收到新的挑戰就重來。 */
  private authenticated = false;
  /** 認證前送出、還沒收到 OK 的事件（ADR-0385）：被回 `auth-required` 的要在認證後重送。有上限，最舊的先丟。 */
  private readonly preAuth = new Map<string, NostrEvent>();
  /** 認證前被拒、等認證完成要重送的事件（ADR-0385）。 */
  private awaitingAuth: NostrEvent[] = [];

  constructor(
    private readonly transport: RelayTransport,
    private readonly handlers: RelayClientHandlers = {},
  ) {}

  /** 發布事件至中繼站。 */
  publish(event: NostrEvent): void {
    // ADR-0385：會回應挑戰的連線在認證前送出的事件先記著——被回 auth-required 就等認證完成再送一次
    if (this.handlers.authSigner && !this.authenticated) {
      this.preAuth.set(event.id, event);
      if (this.preAuth.size > PRE_AUTH_MAX) this.preAuth.delete(this.preAuth.keys().next().value!);
    }
    this.transport.send(JSON.stringify(["EVENT", event]));
  }

  /**
   * 連線斷了（ADR-0385）：同一個 client 會在重連後沿用，下一條連線要重新認證——
   * 斷線期間排隊、重連一開就送出的事件，同樣可能早於認證被拒。
   */
  connectionLost(): void {
    this.authenticated = false;
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
            if (accepted) {
              this.authenticated = true;
              this.preAuth.clear();
              this.handlers.onAuthenticated?.(this); // 先重掛訂閱
              for (const event of this.awaitingAuth.splice(0)) this.transport.send(JSON.stringify(["EVENT", event])); // 再補送
            }
          } else {
            const message = String(msg[3] ?? "");
            const early = this.preAuth.get(id);
            this.preAuth.delete(id);
            // ADR-0385：認證前送出而被拒＝時間點的問題，不是事件的問題——等認證完成重送，這個拒收不往上報
            if (!accepted && early && /^auth-required/i.test(message)) {
              this.awaitingAuth.push(early);
              return;
            }
            this.handlers.onOk?.(id, accepted, message);
          }
        }
        return;
      case "NOTICE":
        if (typeof msg[1] === "string") this.handlers.onNotice?.(msg[1]);
        return;
      case "AUTH":
        // NIP-42：relay 發挑戰 → 以 authSigner 簽 kind 22242 回應（ADR-0057）。
        if (typeof msg[1] === "string" && this.handlers.authSigner) {
          this.authenticated = false; // 新的挑戰：之後送出的事件同樣要等這次認證
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
