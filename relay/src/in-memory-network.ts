import { RelayClient, type RelayClientHandlers } from "@cinderous/core";
import { RelayCore, type RelayCoreOptions } from "@cinderous/client/relay";

export interface InMemoryRelayNetwork {
  /** 內部的 RelayCore（可檢視/操作）。 */
  core: RelayCore;
  /**
   * 連入一個客戶端，回傳已接好收發的 RelayClient。`close()` 真的斷線：中繼忘掉這條連線的訂閱、
   * 之後送給它的不再送達、它送出的也不再處理——與真實 WebSocket 相同。
   * 沒有它的話，`stop()` 過的後端會繼續收訊息、照樣反應，測試靠這種「殭屍實例」通過而不自知。
   */
  connect(connId: string, handlers?: RelayClientHandlers): RelayClient & { close(): void };
}

export interface InMemoryNetworkOptions extends RelayCoreOptions {
  /**
   * 本站主機（ADR-0260）。NIP-62 的清除請求要驗 `relay` tag 指向本站，而那是 fail-closed 的
   * ——**沒有主機資訊就只認 `ALL_RELAYS`**。要在記憶體網路上端到端測具名的清除請求就得給它。
   */
  host?: string;
}

/**
 * 在記憶體中以真實 RelayCore 串接多個 RelayClient（無真實網路），
 * 供整合測試與瀏覽器 demo 共用，避免各處重造 route/clients 接線。
 */
export function createInMemoryRelayNetwork(opts?: InMemoryNetworkOptions): InMemoryRelayNetwork {
  const core = new RelayCore(opts);
  const clients = new Map<string, RelayClient>();
  const route = (outbound: ReturnType<RelayCore["handle"]>): void => {
    for (const { to, message } of outbound) clients.get(to)?.receive(JSON.stringify(message));
  };
  return {
    core,
    connect(connId: string, handlers: RelayClientHandlers = {}): RelayClient & { close(): void } {
      let closed = false;
      const client = new RelayClient(
        { send: (data) => (closed ? undefined : route(core.handle(connId, data))) },
        handlers,
      );
      clients.set(connId, client);
      route(core.connect(connId, opts?.host)); // 送出 NIP-42 AUTH 挑戰（requireAuth 時；否則空）
      return Object.assign(client, {
        close: () => {
          if (closed) return;
          closed = true;
          // 同一個 connId 之後又連上的是另一條連線：只有還是自己時才讓中繼忘掉
          if (clients.get(connId) !== client) return;
          clients.delete(connId);
          core.disconnect(connId);
        },
      });
    },
  };
}

/** 多主機（分片）記憶體網路（ADR-0241）：每個 host（分片 URL）＝一個獨立 RelayCore（＝一個 DO）。 */
export interface ShardedRelayNetwork {
  /** 連入某 host（分片 URL）的獨立 relay；同 host 的連線共用同一 core（如同一個分片 DO）。 */
  connect(host: string, connId: string, handlers?: RelayClientHandlers): RelayClient & { close(): void };
  /** 取某 host 的 core（供測試檢視某分片的離線留言）。 */
  coreFor(host: string): RelayCore;
}

/**
 * 分片網路（ADR-0241 客戶端測試用）：以 host（分片 URL）為鍵，各自一個獨立 `InMemoryRelayNetwork`
 * （＝獨立 core＝獨立 DO）。發給 B → 連 `shard(B)` → 落在 B 的分片 core；B 的收件匣訂閱也連 `shard(B)`
 * → 收得到。天然模擬「一片＝一 DO、跨分片路由」。
 */
export function createShardedRelayNetwork(opts?: RelayCoreOptions): ShardedRelayNetwork {
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
