// 正式版 Node.js 中繼站主機：跑與 Cloudflare 相同的 RelayCore，可在任何 Node 22+ 機器
// （例如樹莓派）長駐執行。離線留言以 Node 內建 SQLite 檔案持久化、預設要求 NIP-42 認證、
// 每小時清除過期留言（對應 Cloudflare 版的 DO alarm）。設定與對外方式見
// docs/self-hosting-raspberry-pi.md。
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { WebSocketServer, type WebSocket } from "ws";
import { ABUSE_GUARD, acceptFileEvents, eventsPerMinuteFrom, firstHost, storeOptions } from "./host-config.js";
import { RelayCore, type Outbound, type RelayCoreOptions } from "./relay-core.js";
import { type SqlExec, SqlMessageStore } from "./sql-message-store.js";

// node:sqlite 太新、打包器的內建模組表未收錄 → 以 createRequire 動態載入（型別走 type-only）。
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DB_PATH ?? "cinder-relay.db";
const requireAuth = process.env.REQUIRE_AUTH !== "0"; // 預設開 NIP-42 認證；設 REQUIRE_AUTH=0 可關
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const db = new DatabaseSync(dbPath);
const exec: SqlExec = (query, ...bindings) => {
  const stmt = db.prepare(query);
  if (/^\s*select/i.test(query)) return stmt.all(...bindings) as Record<string, unknown>[];
  stmt.run(...bindings);
  return [];
};
const store = new SqlMessageStore(exec, storeOptions(process.env.MAX_TTL_DAYS));
// 濫用防護（ADR-0235 H1）由 `host-config` 統一供應——與 Cloudflare 版用同一組常數。
// 速率上限可用 MAX_EVENTS_PER_MINUTE 覆寫（自架站專屬）：未設＝120、設 0＝關閉。
// 用 delete 而非指派 undefined（exactOptionalPropertyTypes 不允許顯式 undefined）。
const coreOptions: RelayCoreOptions = { store, requireAuth, ...ABUSE_GUARD };
const rate = eventsPerMinuteFrom(process.env.MAX_EVENTS_PER_MINUTE);
if (rate === undefined) delete coreOptions.maxEventsPerMinute;
else coreOptions.maxEventsPerMinute = rate;
if (acceptFileEvents(process.env.MAX_FILE_MB)) coreOptions.acceptFileEvents = true;
const core = new RelayCore(coreOptions);

const sockets = new Map<string, WebSocket>();
let counter = 0;
const dispatch = (out: Outbound[]): void => {
  for (const { to, message } of out) sockets.get(to)?.send(JSON.stringify(message));
};

// 掛在 HTTP 伺服器上：一般請求回 200（讓 PaaS/容器健康檢查通過，比照 Cloudflare worker），
// WebSocket 升級請求交給 ws。純 WS 伺服器對 GET / 不回應會被健康檢查誤判為離線。
const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Cinderous relay");
});
const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", (ws, req) => {
  const id = `c${counter++}`;
  sockets.set(id, ws);
  // 本次連線打到的主機（ADR-0235 H2）：AUTH 的 `relay` tag 必須指向它。反向代理後方以
  // `X-Forwarded-Host` 為準（否則會拿到內網的 `localhost:8787`，把所有客戶端擋在門外）。
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host) as string | undefined;
  dispatch(core.connect(id, firstHost(host))); // NIP-42 AUTH 挑戰
  ws.on("message", (data) => dispatch(core.handle(id, data.toString())));
  const cleanup = (): void => {
    core.disconnect(id);
    sockets.delete(id);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

// 每小時清除已過期留言（NIP-40）；對應 Cloudflare 版的 DO alarm（ADR-0056/0059）。
setInterval(() => store.prune(Math.floor(Date.now() / 1000)), PRUNE_INTERVAL_MS);

httpServer.listen(port, () => {
  console.log(`Cinderous node-relay：ws://0.0.0.0:${port}（DB=${dbPath}, requireAuth=${requireAuth}）`);
});
