// 正式版 Node.js 中繼站主機：跑與 Cloudflare 相同的 RelayCore，可在任何 Node 22+ 機器
// （例如樹莓派）長駐執行。離線留言以 Node 內建 SQLite 檔案持久化、預設要求 NIP-42 認證、
// 每小時清除過期留言（對應 Cloudflare 版的 DO alarm）。設定與對外方式見
// docs/self-hosting-raspberry-pi.md。
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { TIMESTAMP_JITTER_SECONDS } from "@cinderous/core";
import { WebSocketServer, type WebSocket } from "ws";
import { RelayCore, type Outbound } from "./relay-core.js";
import { type SqlExec, SqlMessageStore } from "./sql-message-store.js";

// node:sqlite 太新、打包器的內建模組表未收錄 → 以 createRequire 動態載入（型別走 type-only）。
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DB_PATH ?? "cinder-relay.db";
const requireAuth = process.env.REQUIRE_AUTH !== "0"; // 預設開 NIP-42 認證；設 REQUIRE_AUTH=0 可關
const maxPerRecipient = Number(process.env.MAX_PER_RECIPIENT ?? 500);
// TTL 上限（天，ADR-0160）：企業自架站可放寬離線留言保留；未設/壞值＝預設 7 天。
// 上界 clamp 3650 天（審查修正：防手誤產生實質無界保留）。
const maxTtlDays = Math.min(Number(process.env.MAX_TTL_DAYS ?? 0), 3650);
// 檔案塊開關（ADR-0162）：≥1 才收 FILE_WRAP(1060)；未設＝整類拒收。
const maxFileMb = Number(process.env.MAX_FILE_MB ?? 0);
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const db = new DatabaseSync(dbPath);
const exec: SqlExec = (query, ...bindings) => {
  const stmt = db.prepare(query);
  if (/^\s*select/i.test(query)) return stmt.all(...bindings) as Record<string, unknown>[];
  stmt.run(...bindings);
  return [];
};
const store = new SqlMessageStore(exec, {
  maxPerRecipient,
  ...(Number.isFinite(maxTtlDays) && maxTtlDays >= 1 ? { maxTtlSeconds: Math.floor(maxTtlDays) * 86_400 } : {}),
});
// 濫用防護（ADR-0235 H1）：與 Cloudflare 版同一組參數。過去窗必須大於 NIP-59 的 2 天
// 抖動窗，否則會擋掉幾乎每一則 Gift Wrap。速率上限可用 MAX_EVENTS_PER_MINUTE 覆寫。
const maxEventsPerMinute = Number(process.env.MAX_EVENTS_PER_MINUTE ?? 120);
const core = new RelayCore({
  store,
  requireAuth,
  maxSubscriptions: 16,
  authMaxAgeSec: 600, // NIP-42 建議（ADR-0235 H2）
  ...(Number.isFinite(maxEventsPerMinute) && maxEventsPerMinute >= 1 ? { maxEventsPerMinute } : {}),
  maxFutureSkewSec: 15 * 60,
  maxPastSkewSec: TIMESTAMP_JITTER_SECONDS + 60 * 60,
  replayWindowSec: 60 * 60,
  ...(Number.isFinite(maxFileMb) && maxFileMb >= 1 ? { acceptFileEvents: true } : {}),
});

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
  dispatch(core.connect(id, host?.split(",")[0]?.trim().toLowerCase())); // NIP-42 AUTH 挑戰
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
