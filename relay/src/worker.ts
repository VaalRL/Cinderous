import { RelayCore, type Outbound } from "./relay-core.js";
import { SqlMessageStore } from "./sql-message-store.js";

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
}

/** 每收件人離線留言上限（防單一收件人塞爆免費額度；PRD §8）。 */
const MAX_PER_RECIPIENT = 500;

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
  private readonly conns = new Map<string, WebSocket>();

  constructor(ctx: DurableObjectState, _env: Env) {
    // 離線留言持久化於 DO 內建 SQLite（同步、免 D1；ADR-0056）。
    const sql = ctx.storage.sql;
    const exec = (query: string, ...bindings: (string | number | null)[]): Record<string, unknown>[] =>
      sql.exec(query, ...bindings).toArray() as Record<string, unknown>[];
    this.core = new RelayCore({ store: new SqlMessageStore(exec, { maxPerRecipient: MAX_PER_RECIPIENT }) });
  }

  fetch(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connId = crypto.randomUUID();

    server.accept();
    this.conns.set(connId, server);
    this.core.connect(connId);

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
