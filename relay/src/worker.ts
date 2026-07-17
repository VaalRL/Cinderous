import { RelayCore, type ConnSnapshot, type Outbound } from "./relay-core.js";
import { SqlMessageStore } from "./sql-message-store.js";

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
  /**
   * 離線留言 TTL 上限（天，ADR-0160）：企業自架站以 wrangler var 放寬（例 "90"）。
   * 未設/壞值＝預設 7 天。發送端蓋超過此上限的過期章會被截斷——站方上限恆為權威。
   */
  MAX_TTL_DAYS?: string;
  /**
   * 接受檔案塊事件（ADR-0162）：≥1 才收 FILE_WRAP(1060)；未設＝整類拒收（公共站預設）。
   * 值目前僅作開關（實際上限由名冊政策 relayFilesMaxMb ≤16 控制）。
   */
  MAX_FILE_MB?: string;
}

/** 每收件人離線留言上限（防單一收件人塞爆免費額度；PRD §8）。 */
const MAX_PER_RECIPIENT = 500;
/** 每連線訂閱數上限（ADR-0119）：客戶端合併後只用 1 個 REQ，16 已極寬鬆。 */
const MAX_SUBSCRIPTIONS = 16;

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

/**
 * 持有 RelayCore；以**休眠式 WebSocket**（ADR-0059）收發：DO 可在訊息間休眠、不計 idle
 * duration。休眠會清空記憶體，故每連線的訂閱/認證狀態存在其 WebSocket 的 attachment，
 * 喚醒時從所有存活連線的 attachment 重建 RelayCore。
 */
export class RelayRoom {
  private readonly ctx: DurableObjectState;
  private readonly core: RelayCore;
  private readonly store: SqlMessageStore;
  /** 本次喚醒是否已從 attachment 重建 RelayCore 狀態。 */
  private hydrated = false;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    // 離線留言持久化於 DO 內建 SQLite（同步、免 D1；ADR-0056）——storage 跨休眠存活。
    const sql = ctx.storage.sql;
    const exec = (query: string, ...bindings: (string | number | null)[]): Record<string, unknown>[] =>
      sql.exec(query, ...bindings).toArray() as Record<string, unknown>[];
    // TTL 上限（ADR-0160）：企業站可放寬；未設/壞值＝預設 7 天。上界 clamp 3650 天（審查修正：
    // 防 `MAX_TTL_DAYS=99999` 這類手誤產生實質無界保留）。
    const ttlDays = Math.min(Number(env.MAX_TTL_DAYS ?? 0), 3650);
    this.store = new SqlMessageStore(exec, {
      maxPerRecipient: MAX_PER_RECIPIENT,
      ...(Number.isFinite(ttlDays) && ttlDays >= 1 ? { maxTtlSeconds: Math.floor(ttlDays) * 86_400 } : {}),
    });
    const fileMb = Number(env.MAX_FILE_MB ?? 0); // ADR-0162：檔案塊開關
    // NIP-42 AUTH（ADR-0057）：開放中繼要求認證——只有本人能拉自己的加密收件匣。
    // 每連線訂閱數上限（ADR-0119）：`relay-core` 一直有這道防禦（含正確的 `CLOSED rate-limited`
    // 回應），但**從來沒被啟用**——而這是**單一全域房間 DO**（所有人共用），任何人自產一把金鑰
    // 通過 AUTH 後即可開無限訂閱把 DO 記憶體撐爆 → **全站掛掉**。
    // 客戶端合併後只需 1 個 REQ（ADR-0109），16 已是非常寬鬆的上限。
    this.core = new RelayCore({
      store: this.store,
      requireAuth: true,
      maxSubscriptions: MAX_SUBSCRIPTIONS,
      ...(Number.isFinite(fileMb) && fileMb >= 1 ? { acceptFileEvents: true } : {}),
    });
    // C2：排程 NIP-40 過期清理（DO 休眠仍會被 alarm 喚醒執行）。
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
      }
    });
  }

  /** DO 定時鬧鐘（C2）：清除已過期留言並重排下一次。 */
  async alarm(): Promise<void> {
    this.store.prune(Math.floor(Date.now() / 1000));
    await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
  }

  fetch(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connId = crypto.randomUUID();
    // 休眠式接受：以 connId 為 tag 供路由；DO 於訊息間可休眠（ADR-0059）。
    this.ctx.acceptWebSocket(server, [connId]);
    this.ensureHydrated();
    const out = this.core.connect(connId); // 產生 NIP-42 AUTH 挑戰
    this.persist(server, connId); // 存回 attachment（含挑戰），休眠後可還原
    this.dispatch(out);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.ensureHydrated();
    const connId = connIdOf(ws);
    if (!connId) return;
    const raw = typeof message === "string" ? message : "";
    const out = this.core.handle(connId, raw);
    this.persist(ws, connId); // 訂閱/認證可能已變，更新 attachment
    this.dispatch(out);
  }

  webSocketClose(ws: WebSocket): void {
    this.ensureHydrated();
    const connId = connIdOf(ws);
    if (connId) this.core.disconnect(connId);
    try {
      ws.close();
    } catch {
      /* 已關閉 */
    }
  }

  webSocketError(ws: WebSocket): void {
    const connId = connIdOf(ws);
    if (connId) this.core.disconnect(connId);
  }

  /** 休眠喚醒後，從所有存活 WebSocket 的 attachment 重建 RelayCore 狀態（ADR-0059）。 */
  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const ws of this.ctx.getWebSockets()) {
      const snap = ws.deserializeAttachment() as ConnSnapshot | null;
      if (snap) this.core.rehydrate(snap);
    }
  }

  private persist(ws: WebSocket, connId: string): void {
    ws.serializeAttachment(this.core.exportConn(connId));
  }

  private dispatch(outbound: Outbound[]): void {
    for (const { to, message } of outbound) {
      const [ws] = this.ctx.getWebSockets(to); // 以 connId tag 找回該連線
      ws?.send(JSON.stringify(message));
    }
  }
}

/** 從 WebSocket 的 attachment 取回其 connId。 */
function connIdOf(ws: WebSocket): string | undefined {
  const snap = ws.deserializeAttachment() as ConnSnapshot | null;
  return snap?.connId;
}
