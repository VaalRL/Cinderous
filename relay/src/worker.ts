import { RelayCore, type Outbound } from "./relay-core.js";

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
}

/** Worker 進入點：WebSocket 升級後交給單一 Durable Object 房間以共享連線狀態。 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Nostr Buddy relay", { status: 200 });
    }
    const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName("global"));
    return stub.fetch(request);
  },
};

/** 持有 RelayCore 與所有 WebSocket，負責實際收發。 */
export class RelayRoom {
  private readonly core = new RelayCore();
  private readonly conns = new Map<string, WebSocket>();

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
