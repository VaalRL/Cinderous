import { WebSocketServer, type WebSocket } from "ws";
import { MessageStore } from "./message-store.js";
import { RelayCore } from "./relay-core.js";

/**
 * 本機開發用的真實 Nostr relay：以 `ws` 包住與生產同一套 `RelayCore`。
 * 供兩個瀏覽器分頁/客戶端經真實 WebSocket 對話（Cloudflare 部署見 worker.ts）。
 *
 * 用法：`pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev`
 */
const port = Number(process.env.PORT ?? 8787);
const core = new RelayCore({ store: new MessageStore({ maxPerRecipient: 500 }) });
const sockets = new Map<string, WebSocket>();
let counter = 0;

const wss = new WebSocketServer({ port });

wss.on("connection", (ws) => {
  const id = `c${counter++}`;
  sockets.set(id, ws);
  for (const { to, message } of core.connect(id)) sockets.get(to)?.send(JSON.stringify(message)); // AUTH 挑戰

  ws.on("message", (data) => {
    for (const { to, message } of core.handle(id, data.toString())) {
      sockets.get(to)?.send(JSON.stringify(message));
    }
  });

  const cleanup = (): void => {
    core.disconnect(id);
    sockets.delete(id);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

console.log(`Cinderous dev relay 於 ws://localhost:${port}`);
