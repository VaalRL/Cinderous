import { verifyHttpAuth } from "@cinderous/core";
import { ABUSE_GUARD, acceptFileEvents, firstHost, storeOptions } from "./host-config.js";
import { buildRelayInfo, NIP11_HEADERS, wantsRelayInfo } from "./nip11.js";
import { RelayCore, type ConnSnapshot, type Outbound } from "./relay-core.js";
import { shardNameForPath } from "./shard.js";
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
  /**
   * 公共 TURN 保底（ADR-0243）：Cloudflare TURN 的 Key ID。與 `TURN_API_TOKEN` 一起設定後，
   * `GET /turn` 會向 Cloudflare 換發**短期**憑證回給客戶端（餵進 `buildRtcConfig` 的 turnServers）。
   * **未設＝端點回 204，客戶端退回純 STUN**（no-op，不影響既有部署）。
   */
  TURN_KEY_ID?: string;
  /** 公共 TURN 保底（ADR-0243）：Cloudflare TURN 的 API Token（secret，以 `wrangler secret put` 放）。 */
  TURN_API_TOKEN?: string;
  /** 短期 TURN 憑證有效秒數（ADR-0243）；未設/壞值＝預設 86400（1 天）。客戶端於半 TTL 前刷新。 */
  TURN_TTL_SECONDS?: string;
  /**
   * 取得速率限制（ADR-0342 §3.1）：以 pubkey 計數，超過即 429。
   * **未綁定＝不限速**（本地開發與測試無此 binding，不該因此壞掉）。
   *
   * ⚠ Cloudflare 明說它 **per-location 計數且最終一致、刻意寬鬆**——
   * 它是成本乘數，不是閘門。
   */
  TURN_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  // ── NIP-11 Relay Information Document（ADR-0260／0089／0092）─────────────────
  /** 站名／描述／營運者公鑰（hex）／聯絡方式；未設＝該欄不出現在文件裡。 */
  RELAY_NAME?: string;
  RELAY_DESCRIPTION?: string;
  RELAY_PUBKEY?: string;
  RELAY_CONTACT?: string;
  /** 營運者自報的贊助管道（ADR-0089）；**全部未設＝文件無 `cinder_donations`＝客戶端不顯示贊助卡**。 */
  DONATE_GITHUB_SPONSORS?: string;
  DONATE_BUY_ME_A_COFFEE?: string;
  DONATE_LIBERAPAY?: string;
  DONATE_LIGHTNING?: string;
  /** 節點自報（ADR-0092）：已簽章的 `CinderNodeDeclaration` 事件 JSON 字串。 */
  NODE_ATTESTATION?: string;
}

/** Cloudflare TURN 憑證換發 API（POST，Bearer token）。 */
const CF_TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys";

/** 短期憑證秒數：正整數才採用，否則預設 1 天。 */
function turnTtlSeconds(raw?: string): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 86400;
}

/**
 * `GET /turn`（ADR-0243）：以站方 secret 向 Cloudflare 換發**短期** TURN 憑證回給客戶端。
 * 未配 `TURN_KEY_ID`/`TURN_API_TOKEN` → **204**（客戶端 no-op、退回純 STUN）；Cloudflare 故障
 * 亦回 204（保底抓不到不該讓客戶端報錯）。憑證短期＋Cloudflare 端用量上限＝ADR-0243 的「有上限」。
 */
export async function mintTurnResponse(
  env: Env,
  request: Request,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const keyId = env.TURN_KEY_ID;
  const token = env.TURN_API_TOKEN;
  if (!keyId || !token) return new Response(null, { status: 204 }); // 未配置＝no-op

  // 🔴 ADR-0342 §3.2：先驗身分。**401 而非 204**——204 的語意是「站方未配置」，
  // 兩者不可混：客戶端對 204 是安靜退回純 STUN，對 401 才知道是自己沒帶授權。
  const pubkey = verifyHttpAuth(request.headers.get("Authorization"), request.url, request.method);
  if (!pubkey) return new Response(null, { status: 401 });

  // ADR-0342 §3.1：以 **pubkey** 計數而非 IP——行動網路大量共用 IP，用 IP 會誤傷。
  // ⚠ 這是成本乘數不是閘門：Cloudflare 明說它 per-location 計數且最終一致。
  if (env.TURN_LIMIT) {
    const { success } = await env.TURN_LIMIT.limit({ key: pubkey });
    if (!success) return new Response(null, { status: 429 });
  }

  const ttl = turnTtlSeconds(env.TURN_TTL_SECONDS);
  try {
    const res = await fetchFn(`${CF_TURN_API}/${encodeURIComponent(keyId)}/credentials/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl }),
    });
    if (!res.ok) return new Response(null, { status: 204 });
    // ⓪ ADR-0342 §2：把 **ttl 一起回給客戶端**。
    // 先前沒有這個欄位，客戶端只好寫死 6 小時刷新——TTL 一縮短，憑證就在客戶端不知情的
    // 情況下過期，TURN 形同失效。這裡送的就是我們送給 Cloudflare 的那個值（唯一真實來源）。
    const body = (await res.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...body, ttl }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store", // 短期憑證，勿快取
        "Access-Control-Allow-Origin": "*", // 客戶端（Tauri/瀏覽器）跨源抓取
      },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
}

/**
 * 由 Worker 環境變數組出 NIP-11 文件（ADR-0260）。
 *
 * `authRequired: true` 是**寫死**的——worker 的 `RelayCore` 就是 `requireAuth: true`
 * （見 `RelayRoom` 建構子），拿一個獨立的旗標去描述它遲早會說謊。
 */
export function relayInfoFrom(env: Env): Record<string, unknown> {
  return buildRelayInfo({
    name: env.RELAY_NAME,
    description: env.RELAY_DESCRIPTION,
    pubkey: env.RELAY_PUBKEY,
    contact: env.RELAY_CONTACT,
    maxTtlDays: env.MAX_TTL_DAYS,
    acceptsFiles: acceptFileEvents(env.MAX_FILE_MB),
    authRequired: true,
    donations: {
      github_sponsors: env.DONATE_GITHUB_SPONSORS,
      buy_me_a_coffee: env.DONATE_BUY_ME_A_COFFEE,
      liberapay: env.DONATE_LIBERAPAY,
      lightning: env.DONATE_LIGHTNING,
    },
    nodeAttestation: env.NODE_ATTESTATION,
  });
}

/** NIP-40 過期留言的清理間隔（C2）：DO alarm 每小時 prune 一次。 */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Worker 進入點：WebSocket 升級後交給單一 Durable Object 房間以共享連線狀態。 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") {
      // 公共 TURN 保底端點（ADR-0243）：換發短期憑證；未配 secret 則 204、客戶端退回純 STUN。
      if (url.pathname === "/turn") return mintTurnResponse(env, request);
      // NIP-11（ADR-0260）：只有明確要 `application/nostr+json` 的請求拿到 JSON；
      // 其餘維持純文字 200（PaaS／容器健康檢查靠它，ADR-0089 定下的契約）。
      if (wantsRelayInfo(request.headers.get("Accept"))) {
        return new Response(JSON.stringify(relayInfoFrom(env)), { status: 200, headers: NIP11_HEADERS });
      }
      return new Response("Cinderous relay", { status: 200 });
    }
    // 分片路由（ADR-0241）：依 URL 路徑選 DO——`/s/<prefix>` 訊息片、`/presence` 獨立層、
    // 其他（含 `/`）回退舊全域 DO（遷移期＋最低版本閘前的舊客戶端）。每個實例都是獨立 RelayRoom，
    // 血條＝一片崩只影響其 1/16 使用者。
    const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(shardNameForPath(url.pathname)));
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
    this.store = new SqlMessageStore(exec, storeOptions(env.MAX_TTL_DAYS));
    // 濫用防護（ADR-0235 H1）由 `host-config` 統一供應——與 `node-relay.ts` 用同一組常數，
    // 兩座宿主不可能各走各的。NIP-42 AUTH（ADR-0057）＋單一全域房間 DO 的背景見該檔註解。
    this.core = new RelayCore({
      store: this.store,
      requireAuth: true,
      ...ABUSE_GUARD,
      ...(acceptFileEvents(env.MAX_FILE_MB) ? { acceptFileEvents: true } : {}),
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

  fetch(request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connId = crypto.randomUUID();
    // 休眠式接受：以 connId 為 tag 供路由；DO 於訊息間可休眠（ADR-0059）。
    this.ctx.acceptWebSocket(server, [connId]);
    this.ensureHydrated();
    // 本次請求打到的主機（ADR-0235 H2）：AUTH 的 `relay` tag 必須指向它。取自 request 而非
    // 設定檔——同一份 Worker 可能同時服務 workers.dev 與自訂網域，寫死任一個都會誤擋另一個。
    const relayHost = hostOf(request);
    const out = this.core.connect(connId, relayHost); // 產生 NIP-42 AUTH 挑戰
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

/** 本次請求的主機（含 port）；優先取 `Host` 標頭，退回 URL。解析失敗回 undefined＝不強制。 */
function hostOf(request: Request): string | undefined {
  const header = firstHost(request.headers.get("Host") ?? undefined);
  if (header) return header;
  try {
    return new URL(request.url).host.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}
