import { RelayCore, type Outbound } from "./relay-core.js";
import { SqlMessageStore } from "./sql-message-store.js";

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
}

/** 每收件人離線留言上限（防單一收件人塞爆免費額度；PRD §8）。 */
const MAX_PER_RECIPIENT = 500;

/** NIP-40 過期留言的清理間隔（C2）：DO alarm 每小時 prune 一次。 */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Worker 進入點：WebSocket 升級後交給單一 Durable Object 房間以共享連線狀態。 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Cinder relay", { status: 200 });
    }
    const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName("global"));
    return stub.fetch(request);
  },
};

/** 持有 RelayCore 與所有 WebSocket，負責實際收發。 */
export class RelayRoom {
  private readonly core: RelayCore;
  private readonly store: SqlMessageStore;
  private readonly storage: DurableObjectStorage;
  private readonly conns = new Map<string, WebSocket>();

  constructor(ctx: DurableObjectState, _env: Env) {
    // 離線留言持久化於 DO 內建 SQLite（同步、免 D1；ADR-0056）。
    this.storage = ctx.storage;
    const sql = ctx.storage.sql;
    const exec = (query: string, ...bindings: (string | number | null)[]): Record<string, unknown>[] =>
      sql.exec(query, ...bindings).toArray() as Record<string, unknown>[];
    this.store = new SqlMessageStore(exec, { maxPerRecipient: MAX_PER_RECIPIENT });
    // NIP-42 AUTH（ADR-0057）：開放中繼要求認證——只有本人能拉自己的加密收件匣。
    this.core = new RelayCore({ store: this.store, requireAuth: true });
    // C2：排程 NIP-40 過期清理——若尚未設過 alarm 則設一個（DO 休眠仍會被喚醒執行）。
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
      }
    });
  }

  /** DO 定時鬧鐘（C2）：清除已過期留言並重排下一次。 */
  async alarm(): Promise<void> {
    this.store.prune(Math.floor(Date.now() / 1000));
    await this.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
  }

  fetch(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connId = crypto.randomUUID();

    server.accept();
    this.conns.set(connId, server);
    this.dispatch(this.core.connect(connId)); // 送出 NIP-42 AUTH 挑戰（requireAuth 時；否則空）

    server.addEventListener("message", (evt: MessageEvent) => {
      const raw = typeof evt.data === "string" ? evt.data : "";
      this.dispatch(this.core.handle(connId, raw));
    });

    const cleanup = (): void => {
      this.core.disconnect(connId);
      this.conns.delete(connId);
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  private dispatch(outbound: Outbound[]): void {
    for (const { to, message } of outbound) {
      this.conns.get(to)?.send(JSON.stringify(message));
    }
  }
}
