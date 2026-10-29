import {
  connectRelay,
  RelayClient,
  type RelayClientHandlers,
  type RelayConnection,
  type SocketLike,
} from "@cinderous/core";
import { RelayCore, type RelayCoreOptions } from "@cinderous/client/relay";

/** 記憶體網路的一條連線：`close()` 一定有（ADR-0399） */
export type InMemoryConnection = RelayConnection & { close(): void };

export interface InMemoryRelayNetwork {
  /** 內部的 RelayCore（可檢視/操作）。 */
  core: RelayCore;
  /**
   * 連入一個客戶端（ADR-0400）：走與正式環境**同一個**連線層——core 的 `connectRelay`（SDK `RelayPool`），
   * 只是 socket 換成記憶體的。所以 SDK 的驗簽、以 id 去重、NIP-42、補訂閱在測試裡一樣成立；
   * OK 經 SDK 的發布結果回來，晚一個微任務（測試要 `await` 才看得到「已送中繼」）。
   *
   * `close()` 真的斷線（ADR-0399）：中繼忘掉這條連線的訂閱、之後送給它的不再送達、它送出的也不再處理。
   */
  connect(connId: string, handlers?: RelayClientHandlers): InMemoryConnection;
  /**
   * 直連（不經 SDK）：同步送達、OK 立刻回。只給展示模式（`BrowserChatBackend`）與示範頁用——
   * 它們不需要正式環境的連線行為，也不該多背 SDK 連線池的計時器。測試請用 {@link connect}。
   */
  connectDirect(connId: string, handlers?: RelayClientHandlers): RelayClient & { close(): void };
}

export interface InMemoryNetworkOptions extends RelayCoreOptions {
  /**
   * 本站主機（ADR-0260）。NIP-62 的清除請求要驗 `relay` tag 指向本站，而那是 fail-closed 的
   * ——**沒有主機資訊就只認 `ALL_RELAYS`**。要在記憶體網路上端到端測具名的清除請求就得給它。
   */
  host?: string;
  /**
   * 側錄每一個訊框（ADR-0400）：`out`＝客戶端送給中繼、`in`＝中繼送給客戶端，`frame` 是原始 JSON 字串。
   * 測試要看「線上實際有什麼」（例如 OK 附帶的 `warning:`）時用它——連線層不會把這些轉給 handlers。
   */
  tap?: (connId: string, direction: "in" | "out", frame: string) => void;
}

/**
 * 在記憶體中以真實 RelayCore 串接多個客戶端（無真實網路），
 * 供整合測試與瀏覽器 demo 共用，避免各處重造 route/clients 接線。
 */
export function createInMemoryRelayNetwork(opts?: InMemoryNetworkOptions): InMemoryRelayNetwork {
  const core = new RelayCore(opts);
  const tap = opts?.tap;
  /** connId → 把中繼的訊框交給那條連線 */
  const peers = new Map<string, (frame: string) => void>();
  const route = (outbound: ReturnType<RelayCore["handle"]>): void => {
    for (const { to, message } of outbound) {
      const frame = JSON.stringify(message);
      const deliver = peers.get(to);
      if (!deliver) continue;
      tap?.(to, "in", frame);
      deliver(frame);
    }
  };
  const handle = (connId: string, frame: string): void => {
    tap?.(connId, "out", frame);
    route(core.handle(connId, frame));
  };
  /** 斷線（ADR-0399）：同一個 connId 之後又連上的是另一條連線，只有還是自己時才讓中繼忘掉 */
  const disconnect = (connId: string, deliver: (frame: string) => void): void => {
    if (peers.get(connId) !== deliver) return;
    peers.delete(connId);
    core.disconnect(connId);
  };

  /** 記憶體的 WebSocket：同步開啟、同步收發，讓整個網路維持同步（與直連相同的時序，除了 OK） */
  const socketFor = (connId: string): SocketLike => {
    type Listener = (event: { data?: string; code?: number; reason?: string }) => void;
    const listeners = new Map<string, Listener[]>();
    const emit = (type: string, event: Parameters<Listener>[0]) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    };
    const deliver = (frame: string) => emit("message", { data: frame });
    const socket = {
      readyState: 0,
      addEventListener(type: "open" | "message" | "close" | "error", listener: Listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        // SDK 掛好 open／message／close 就同步開啟：中繼的 AUTH 挑戰在同一個呼叫裡送到（與直連相同）
        if (socket.readyState === 0 && listeners.has("open") && listeners.has("message") && listeners.has("close")) {
          socket.readyState = 1;
          peers.set(connId, deliver);
          emit("open", {});
          route(core.connect(connId, opts?.host)); // NIP-42 AUTH 挑戰（requireAuth 時；否則空）
        }
      },
      // 關了之後 SDK 不會再送（ADR-0399 的「關了送不出」由連線層保證、端到端測試釘住），這裡不再多擋一道
      send: (data: string) => handle(connId, data),
      close() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        disconnect(connId, deliver);
      },
    };
    return socket;
  };

  return {
    core,
    connect(connId: string, handlers: RelayClientHandlers = {}): InMemoryConnection {
      const connection = connectRelay(`wss://memory.invalid/${connId}`, handlers, undefined, {
        createSocket: () => socketFor(connId),
      });
      return connection as InMemoryConnection;
    },
    connectDirect(connId: string, handlers: RelayClientHandlers = {}): RelayClient & { close(): void } {
      let closed = false;
      const client = new RelayClient({ send: (data) => (closed ? undefined : handle(connId, data)) }, handlers);
      const deliver = (frame: string) => client.receive(frame);
      peers.set(connId, deliver);
      route(core.connect(connId, opts?.host)); // 送出 NIP-42 AUTH 挑戰（requireAuth 時；否則空）
      return Object.assign(client, {
        close: () => {
          if (closed) return;
          closed = true;
          disconnect(connId, deliver);
        },
      });
    },
  };
}

/** 多主機（分片）記憶體網路（ADR-0241）：每個 host（分片 URL）＝一個獨立 RelayCore（＝一個 DO）。 */
export interface ShardedRelayNetwork {
  /** 連入某 host（分片 URL）的獨立 relay；同 host 的連線共用同一 core（如同一個分片 DO）。 */
  connect(host: string, connId: string, handlers?: RelayClientHandlers): InMemoryConnection;
  /** 取某 host 的 core（供測試檢視某分片的離線留言）。 */
  coreFor(host: string): RelayCore;
}

/**
 * 分片網路（ADR-0241 客戶端測試用）：以 host（分片 URL）為鍵，各自一個獨立 `InMemoryRelayNetwork`
 * （＝獨立 core＝獨立 DO）。發給 B → 連 `shard(B)` → 落在 B 的分片 core；B 的收件匣訂閱也連 `shard(B)`
 * → 收得到。天然模擬「一片＝一 DO、跨分片路由」。
 */
export function createShardedRelayNetwork(opts?: InMemoryNetworkOptions): ShardedRelayNetwork {
  const nets = new Map<string, InMemoryRelayNetwork>();
  const netFor = (host: string): InMemoryRelayNetwork => {
    let n = nets.get(host);
    if (!n) {
      n = createInMemoryRelayNetwork(opts);
      nets.set(host, n);
    }
    return n;
  };
  return {
    connect: (host, connId, handlers) => netFor(host).connect(connId, handlers),
    coreFor: (host) => netFor(host).core,
  };
}
