import { verifyHttpAuth } from "@cinderous/core";
import {
  acceptFileEvents,
  DEVELOPER_DOCS_URL,
  firstHost,
  guardFor,
  knownLanes,
  powForLane,
  type RelayProfile,
  storeOptions,
} from "./host-config.js";
import { buildRelayInfo, NIP11_HEADERS, wantsRelayInfo } from "./nip11.js";
import { RELAY_WORKER_VERSION } from "./version.js";
import { RelayCore, type ConnSnapshot, type Outbound } from "./relay-core.js";
import { routeForPath } from "./shard.js";
import { type SqlExec, SqlMessageStore } from "./sql-message-store.js";

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
  /**
   * 統一節點（ADR-0354，**選配**）：Workers Static Assets 綁定。設定了就代表這座 Worker
   * 同時是 relay 與網頁版（同一個網址、`wss://` 與 `https://` 分流）；**未綁定＝純 relay、
   * 行為與過去完全相同**（官方錨點站即為此模式）。以 `wrangler --env unified` 部署時才有。
   *
   * 🔴 wrangler 端**必須**同時設 `run_worker_first = true`：Static Assets 預設「資產優先」——
   * 命中資產就直接回傳、**根本不執行本 Worker**，而 `/` 有 `index.html`、又正是 ADR-0241
   * 舊客戶端的 WebSocket 回退路徑 ⇒ 不設就等於把 relay 靜默關掉（回 HTML 200，不是錯誤）。
   */
  ASSETS?: { fetch: (request: Request) => Response | Promise<Response> };
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
   * 第三方車道的 NIP-13 PoW 難度（ADR-0366 P2 #11）。未設＝0（不要求）。
   *
   * 🔴 打開之前**必須先確認該車道的客戶端會挖礦**（core 的 `minePow`）——否則它們的
   * 持久化事件會全部被拒，而客戶端那邊看到的只是 `OK false`。嚴格平面不受此變數影響
   * （恆為 0，見 `host-config.powForLane`）。
   */
  APP_LANE_POW?: string;
  /**
   * 站方的**已知租戶名單**（逗號分隔的車道 id；ADR-0366 §裁示）。
   *
   * 🔴 **不是白名單**：沒列的車道照常服務——錨點同時是公用 relay。名單決定的是
   * 「這條車道有沒有自己的 DO」，因而決定它的可尋址配額（列了 64、沒列 16）。
   * 未設＝沒有已知租戶，所有車道共用雜湊分片。
   *
   * ⚠ 加進來或拿掉＝換一顆 DO，該車道舊 DO 裡的資料不會跟著搬（等 TTL 到期）。
   */
  APP_LANES?: string;
  /**
   * 連線被拒時指向的開發文件網址（ADR-0368）。未設＝官網開發者頁
   * （`host-config.DEVELOPER_DOCS_URL`）。自架站若有自己的說明頁可換掉。
   */
  DEVELOPER_DOCS_URL?: string;
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
  /**
   * 第三方車道的**升級**速率限制（ADR-0366 §容量）：以 **IP** 計數，超過即 429，
   * 而且在碰到 DO 之前就擋掉。**未綁定＝不限速**（本地開發與自架站無此 binding）。
   *
   * 🔴 為什麼是 IP 而不是 pubkey：車道不要求 AUTH，pubkey 由發送方自選、換一把是
   * 微秒級的事（ADR-0342 §3.1 同一個結論）。要限速就得綁比較貴的東西。
   *
   * 🔴 為什麼只擋升級不夠、要和 `maxMessagesPerMinute` 一起看：一條已經建立的連線
   * 可以持續灌訊息而完全不需要再升級。核心那一道超限就關連線，關了要回來就得再升級
   * ——兩道接起來，每個 IP 的**持續**成本才是有界的。
   *
   * ⚠ 嚴格平面刻意不套：那裡是本專案自己的使用者、且要求 NIP-42，而行動網路的
   * 共用 IP 會讓一整群人共用同一個桶。
   */
  APP_LANE_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
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

/**
 * `/turn` 的 CORS 標頭（審查發現 #1）。
 *
 * ⚠ **每一種回應都要帶**（含 401／429／204）——只有 200 帶的話，瀏覽器讀不到錯誤狀態，
 * `fetch` 會直接 reject，客戶端就分不出「被擋」與「站方未配置」。
 */
const TURN_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
  "Access-Control-Max-Age": "86400",
};

/** CORS 預檢回應。 */
export function turnPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: TURN_CORS });
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
  if (!keyId || !token) return new Response(null, { status: 204, headers: TURN_CORS }); // 未配置＝no-op

  // 🔴 ADR-0342 §3.2：先驗身分。**401 而非 204**——204 的語意是「站方未配置」，
  // 兩者不可混：客戶端對 204 是安靜退回純 STUN，對 401 才知道是自己沒帶授權。
  const pubkey = verifyHttpAuth(request.headers.get("Authorization"), request.url, request.method);
  if (!pubkey) return new Response(null, { status: 401, headers: TURN_CORS });

  // ADR-0342 §3.1（審查修正）：**以 IP 計數，不是 pubkey**。
  //
  // 🔴 原本用 pubkey——但 pubkey 由請求方自選、換一把是微秒級的事，
  // 以它計數等於完全沒有限制。要限速就得綁**比較貴的東西**：換 IP 要花錢。
  // ⚠ 代價是行動網路共用 IP 會被一起計數（額度給得寬即可容納）。
  // ⚠ 這仍是速度緩衝而非頻寬上限：Cloudflare 明說它 per-location 計數且最終一致。
  if (env.TURN_LIMIT) {
    const key = request.headers.get("CF-Connecting-IP") ?? pubkey; // 缺標頭（本地/測試）才退回 pubkey
    const { success } = await env.TURN_LIMIT.limit({ key });
    if (!success) return new Response(null, { status: 429, headers: TURN_CORS });
  }

  const ttl = turnTtlSeconds(env.TURN_TTL_SECONDS);
  try {
    const res = await fetchFn(`${CF_TURN_API}/${encodeURIComponent(keyId)}/credentials/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl }),
    });
    if (!res.ok) return new Response(null, { status: 204, headers: TURN_CORS });
    // ⓪ ADR-0342 §2：把 **ttl 一起回給客戶端**。
    // 先前沒有這個欄位，客戶端只好寫死 6 小時刷新——TTL 一縮短，憑證就在客戶端不知情的
    // 情況下過期，TURN 形同失效。這裡送的就是我們送給 Cloudflare 的那個值（唯一真實來源）。
    const body = (await res.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...body, ttl }), {
      status: 200,
      headers: {
        ...TURN_CORS,
        "Content-Type": "application/json",
        "Cache-Control": "no-store", // 短期憑證，勿快取
      },
    });
  } catch {
    return new Response(null, { status: 204, headers: TURN_CORS });
  }
}

/**
 * 由 Worker 環境變數組出 NIP-11 文件（ADR-0260）。
 *
 * `authRequired: true` 是**寫死**的——worker 的 `RelayCore` 就是 `requireAuth: true`
 * （見 `RelayRoom` 建構子），拿一個獨立的旗標去描述它遲早會說謊。
 */
export function relayInfoFrom(
  env: Env,
  profile: RelayProfile = "strict",
  /** 本路徑是不是名單上的已知租戶（ADR-0366 §裁示）：公用分片的保存期短得多（ADR-0367）。 */
  knownLane = false,
): Record<string, unknown> {
  return buildRelayInfo({
    profile,
    knownLane,
    name: env.RELAY_NAME,
    description: env.RELAY_DESCRIPTION,
    pubkey: env.RELAY_PUBKEY,
    contact: env.RELAY_CONTACT,
    maxTtlDays: env.MAX_TTL_DAYS,
    acceptsFiles: acceptFileEvents(env.MAX_FILE_MB),
    // 與實際生效的政策同源（`guardFor`）——拿獨立旗標描述它遲早會說謊（見本檔案上方註解）。
    authRequired: guardFor(profile).requireAuth === true,
    // ADR-0356：出貨版號。讓任何人（與 App 的「一鍵更新節點」）看得出這座跑的是哪一版，
    // 也讓 ADR-0241 的跟版義務從「口頭提醒」變成「查得到的事實」。
    version: RELAY_WORKER_VERSION,
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

/** 升級請求被拒的原因（ADR-0368）。 */
export type RejectKind = "unknown-path" | "bad-lane" | "rate-limited";

/** WebSocket 規格的關閉原因上限（UTF-8 bytes）。 */
const CLOSE_REASON_MAX_BYTES = 123;

/**
 * 拒絕一次 WebSocket 升級，但**說得出為什麼**（ADR-0368）。
 *
 * 🔴 為什麼不直接回 404／429：瀏覽器的 `WebSocket` 不暴露握手的狀態碼與內容，
 * 對方只拿到一個沒有訊息的 `error` 與 close 1006——和「中繼站掛了」一模一樣。
 * 所以在 Worker 內接受、送一則 `NOTICE`、以 1008 關閉，關閉原因也帶文件網址。
 *
 * 🔴 **不碰任何 DO、不套任何政策**：這條連線從頭到尾只存在於這次 Worker 呼叫裡，
 * ADR-0366 §決策 4「認不得的連線不落在任何 DO」原樣成立；成本與原本的 404 同為一次請求。
 *
 * 刻意**不回顯**對方送來的路徑：對方自己知道打了什麼，回顯只會讓中繼站反射任意字串。
 */
export function rejectUpgrade(kind: RejectKind, host: string, env: Pick<Env, "DEVELOPER_DOCS_URL">): Response {
  const docs = env.DEVELOPER_DOCS_URL?.trim() || DEVELOPER_DOCS_URL;
  const lane = `wss://${host}/app/<your-app-id>`;
  const [short, notice] =
    kind === "rate-limited"
      ? ["rate-limited", `rate-limited: too many new connections to app lanes from your IP; retry in a minute. Docs: ${docs}`]
      : kind === "bad-lane"
        ? [
            "invalid app lane",
            `invalid app lane: connect to ${lane}, where the id is 1-64 characters of a-z 0-9 . _ - ` +
              `and starts with a letter or digit (the "/app/" prefix is lowercase). Docs: ${docs}`,
          ]
        : ["unknown relay path", `unknown relay path. Third-party apps connect to ${lane}. Docs: ${docs}`];
  const withDocs = `${short}; docs: ${docs}`;
  const reason = new TextEncoder().encode(withDocs).length <= CLOSE_REASON_MAX_BYTES ? withDocs : short;

  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.send(JSON.stringify(["NOTICE", notice]));
  server.close(1008, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/** Worker 進入點：WebSocket 升級後交給單一 Durable Object 房間以共享連線狀態。 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") {
      // 公共 TURN 保底端點（ADR-0243）：換發短期憑證；未配 secret 則 204、客戶端退回純 STUN。
      if (url.pathname === "/turn") {
        // 🔴 CORS 預檢必須在授權檢查**之前**（審查發現 #1）。
        // `Authorization` 不是 CORS 安全列表標頭 ⇒ 瀏覽器（含 Tauri／Capacitor 的 webview）
        // 會先送 OPTIONS。若讓它走進換發流程，會因為預檢不帶授權而回 401、且無 CORS 標頭
        // ⇒ **瀏覽器直接擋掉整個請求**，客戶端靜默退回純 STUN。
        if (request.method === "OPTIONS") return turnPreflightResponse();
        return mintTurnResponse(env, request);
      }
      // NIP-11（ADR-0260）：只有明確要 `application/nostr+json` 的請求拿到 JSON；
      // 其餘維持純文字 200（PaaS／容器健康檢查靠它，ADR-0089 定下的契約）。
      if (wantsRelayInfo(request.headers.get("Accept"))) {
        // 依路徑回該車道的文件（ADR-0366）：一份文件描述不了兩種政策。
        // 認不得的路徑仍給嚴格版——探測器問錯路徑不該拿到比較寬鬆的描述。
        const infoRoute = routeForPath(url.pathname, knownLanes(env.APP_LANES));
        const profile = infoRoute?.profile ?? "strict";
        const known = infoRoute?.profile === "app" && infoRoute.known;
        return new Response(JSON.stringify(relayInfoFrom(env, profile, known)), {
          status: 200,
          headers: NIP11_HEADERS,
        });
      }
      // 健康檢查落點（ADR-0354）：**兩種模式都回純文字**。統一節點模式下 `/` 會變成網頁版首頁，
      // 而 `docs/SELF-HOSTING*.md` 與 PaaS 健康檢查靠的是 ADR-0089 的純文字契約——搬到這裡而非廢除，
      // 兩座宿主（本檔與 `node-relay.ts`）一致。
      // ADR-0354：純文字 `ok`。**刻意與 `/` 的回應不同**——合體部署後 `/` 會回網頁版，
      // 「首頁回不回 HTML」已經不能拿來判斷中繼站死活，這個端點才是。
      if (url.pathname === "/healthz") return new Response("ok", { status: 200 });
      // 統一節點（ADR-0354，選配）：有 ASSETS 綁定＝這座 Worker 同時是網頁版 ⇒ 其餘 HTTP 交給資產
      // （SPA 深層路由由 `not_found_handling` 回退 index.html）。未綁定＝純 relay，維持純文字。
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Cinderous relay", { status: 200 });
    }
    // 路由（ADR-0241 分片 ＋ ADR-0366 第三方車道）：依 URL 路徑同時決定 **DO 與政策**。
    // 每個實例都是獨立 RelayRoom，血條＝一片崩只影響那一片。
    //
    // 🔴 **認不得的路徑直接拒絕**（ADR-0366 §決策 4）。原本是「其他一律回退舊全域」，
    // 那讓 `/s/zz` 這種算錯分片的客戶端靜默落進別的平面；而一旦有了寬鬆車道，
    // 任何 catch-all 都是一條把流量靜默送進錯誤政策的路。兩邊正面列舉、其餘拒絕（拒絕的形狀見 ADR-0368）。
    const route = routeForPath(url.pathname, knownLanes(env.APP_LANES));
    // 拒絕時要說得出為什麼（ADR-0368）：404 對瀏覽器與 Nostr 函式庫是看不見的。
    if (!route) {
      return rejectUpgrade(/^\/app(\/|$)/i.test(url.pathname) ? "bad-lane" : "unknown-path", url.host, env);
    }
    // 車道的成本護欄（ADR-0366 §容量）：以 IP 計數的升級限速，在碰 DO 之前就擋掉。
    // `CF-Connecting-IP` 由 Cloudflare 填寫、客戶端偽造不了；**缺了就不限**——
    // 那代表根本不在 CF 後面，此時退回單一 key 會讓所有人共用一個額度，
    // 第一個濫用者就把全站擋死（那比不限還糟）。
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (route.profile === "app" && env.APP_LANE_LIMIT && clientIp) {
      const { success } = await env.APP_LANE_LIMIT.limit({ key: clientIp });
      if (!success) return rejectUpgrade("rate-limited", url.host, env);
    }
    // 原始 request 原封不動轉給 DO——DO 對**同一個路徑**跑**同一個** `routeForPath` 算出政策，
    // 所以兩邊不可能不一致。刻意不用標頭傳遞：那要 clone request，而「`Upgrade` 標頭在
    // clone 之後還在不在」是平台細節，賭它不如不賭。
    const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(route.doName));
    return stub.fetch(request);
  },
};

/**
 * 持有 RelayCore；以**休眠式 WebSocket**（ADR-0059）收發：DO 可在訊息間休眠、不計 idle
 * duration。休眠會清空記憶體，故每連線的訂閱/認證狀態存在其 WebSocket 的 attachment，
 * 喚醒時從所有存活連線的 attachment 重建 RelayCore。
 */
/** DO storage 裡記住本實例綁定的政策（ADR-0366）。 */
const PROFILE_KEY = "cinder:lane-profile";
/**
 * DO storage 裡記住本實例服務的是不是名單上的已知租戶（ADR-0366 §裁示）。
 *
 * 為什麼要存：休眠喚醒後可能**沒有 fetch**（`webSocketMessage` 直接進來），那時算不出
 * 車道 id；而配額必須與這顆 DO 先前用的那個一致，否則同一份儲存會被兩種配額讀寫過。
 */
const KNOWN_LANE_KEY = "cinder:lane-known";

export class RelayRoom {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  /** DO 內建 SQLite 的同步執行器；政策確定後要用它重建 store（ADR-0366 P1 #7）。 */
  private readonly exec: SqlExec;
  private core: RelayCore;
  private store: SqlMessageStore;
  /** 本次喚醒是否已從 attachment 重建 RelayCore 狀態。 */
  private hydrated = false;
  /** 本 DO 實例綁定的政策；由路由方在首次請求時釘住（ADR-0366）。 */
  private profile: RelayProfile = "strict";
  /** 政策是否已寫進 storage（釘住後不得再改，見 `fetch`）。 */
  private profilePinned = false;
  /** 本 DO 服務的是名單上的已知租戶嗎（ADR-0366 §裁示）；預設否＝公用配額。 */
  private knownLane = false;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    // 離線留言持久化於 DO 內建 SQLite（同步、免 D1；ADR-0056）——storage 跨休眠存活。
    const sql = ctx.storage.sql;
    const exec = (query: string, ...bindings: (string | number | null)[]): Record<string, unknown>[] =>
      sql.exec(query, ...bindings).toArray() as Record<string, unknown>[];
    this.exec = exec;
    this.store = new SqlMessageStore(exec, storeOptions(env.MAX_TTL_DAYS));
    // 先以嚴格政策組起來：休眠喚醒後可能**沒有 fetch**（`webSocketMessage` 直接進來），
    // 那時還沒讀到 storage，預設必須是**收得最緊**的那一邊。
    this.core = this.buildCore("strict");
    ctx.blockConcurrencyWhile(async () => {
      // 還原本實例綁定的政策（ADR-0366）。DO 名與政策是一對一的，所以這裡讀到什麼就是什麼。
      const stored = await ctx.storage.get<RelayProfile>(PROFILE_KEY);
      this.knownLane = (await ctx.storage.get<boolean>(KNOWN_LANE_KEY)) === true;
      if (stored !== undefined) {
        this.profile = stored;
        this.profilePinned = true;
        if (stored !== "strict") this.core = this.buildCore(stored);
      }
      // C2：排程 NIP-40 過期清理（DO 休眠仍會被 alarm 喚醒執行）。
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
      }
    });
  }

  /**
   * 以指定政策組 `RelayCore`。濫用防護由 `host-config` 統一供應（ADR-0235 H1）——
   * 與 `node-relay.ts` 用同一組常數，兩座宿主不可能各走各的。
   */
  private buildCore(profile: RelayProfile): RelayCore {
    // store 與 core 必須用**同一個** profile 組起來——拆開就會出現
    // 「core 是車道、store 還套著嚴格配額」這種只在第 6 份牌組才看得出來的錯。
    this.store = new SqlMessageStore(
      this.exec,
      storeOptions(this.env.MAX_TTL_DAYS, profile, this.knownLane),
    );
    const pow = powForLane(profile, this.env.APP_LANE_POW);
    return new RelayCore({
      store: this.store,
      ...guardFor(profile),
      ...(pow > 0 ? { minPowDifficulty: pow } : {}),
      ...(acceptFileEvents(this.env.MAX_FILE_MB) ? { acceptFileEvents: true } : {}),
    });
  }

  /** DO 定時鬧鐘（C2）：清除已過期留言並重排下一次。 */
  async alarm(): Promise<void> {
    this.store.prune(Math.floor(Date.now() / 1000));
    await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
  }

  async fetch(request: Request): Promise<Response> {
    // 政策由**本次請求的路徑**決定，用的是與 worker 路由同一個 `routeForPath`（SSOT）。
    // 認不得的路徑在 worker 就被擋掉了（ADR-0368，不碰 DO）；真的漏進來就當嚴格（fail-closed）。
    const route = routeForPath(new URL(request.url).pathname, knownLanes(this.env.APP_LANES));
    const wanted: RelayProfile = route?.profile ?? "strict";
    // 已知租戶有自己的 DO（`app:<id>`），所以這個旗標對一顆 DO 而言是恆定的；
    // 第一次請求時釘住，與政策同一個時機。
    const wantedKnown = route?.profile === "app" && route.known;
    if (wanted !== this.profile || !this.profilePinned || wantedKnown !== this.knownLane) {
      // 🔴 一顆 DO 只服務一種政策。釘住之後還收到不同政策的請求，代表路由壞了
      // （或有人在試）——**拒絕，不要切換**。切換等於讓同一份儲存被兩套規則讀寫過。
      if (this.profilePinned) return new Response("lane profile mismatch", { status: 409 });
      this.knownLane = wantedKnown;
      if (wanted !== this.profile) {
        this.profile = wanted;
      }
      // 配額也會變，所以 core 與 store 一起重組（兩者必須同一組設定）。
      this.core = this.buildCore(wanted);
      await this.ctx.storage.put(PROFILE_KEY, wanted);
      await this.ctx.storage.put(KNOWN_LANE_KEY, wantedKnown);
      this.profilePinned = true;
    }
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
    for (const { to, message, close } of outbound) {
      const [ws] = this.ctx.getWebSockets(to); // 以 connId tag 找回該連線
      ws?.send(JSON.stringify(message));
      if (!close) continue;
      // 超限即關（ADR-0366 §容量）：訊息一旦抵達那次請求就已經付掉了，只回一則
      // NOTICE 擋不住成本。關掉之後要回來就得重新升級，而那一關有 IP 限速。
      this.core.disconnect(to); // 伺服端主動關閉不保證會觸發 webSocketClose
      try {
        ws?.close(1008, "rate-limited");
      } catch {
        /* 已關閉 */
      }
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
