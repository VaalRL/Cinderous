import { RelayClient, type RelayClientHandlers } from "@cinderous/core";
import { RelayCore, type RelayCoreOptions } from "./relay-core.js";

export interface InMemoryRelayNetwork {
  /** 內部的 RelayCore（可檢視/操作）。 */
  core: RelayCore;
  /** 連入一個客戶端，回傳已接好收發的 RelayClient。 */
  connect(connId: string, handlers?: RelayClientHandlers): RelayClient;
}

/**
 * 在記憶體中以真實 RelayCore 串接多個 RelayClient（無真實網路），
 * 供整合測試與瀏覽器 demo 共用，避免各處重造 route/clients 接線。
 */
export function createInMemoryRelayNetwork(opts?: RelayCoreOptions): InMemoryRelayNetwork {
  const core = new RelayCore(opts);
  const clients = new Map<string, RelayClient>();
  const route = (outbound: ReturnType<RelayCore["handle"]>): void => {
    for (const { to, message } of outbound) clients.get(to)?.receive(JSON.stringify(message));
  };
  return {
    core,
    connect(connId: string, handlers: RelayClientHandlers = {}): RelayClient {
      const client = new RelayClient({ send: (data) => route(core.handle(connId, data)) }, handlers);
      clients.set(connId, client);
      route(core.connect(connId)); // 送出 NIP-42 AUTH 挑戰（requireAuth 時；否則空）
      return client;
    },
  };
}
