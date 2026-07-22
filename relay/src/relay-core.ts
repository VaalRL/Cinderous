import { AUTH_KIND, authChallengeOf, authRelayMatches, verifyEvent, type NostrEvent } from "@cinderous/core";
import { matchFilter } from "./filters.js";

/**
 * 單一 filter 的 `authors` 上限（ADR-0123）：擋掉「用 `authors: [十萬把金鑰]` 枚舉全站」。
 * 1024 遠大於任何真實聯絡人清單／組織名冊，也遠小於枚舉所需。
 */
const MAX_AUTHORS = 1024;

/**
 * 單則客戶端訊息的原始位元組上限（ADR-0235 C3）：**在 `JSON.parse` 之前**檢查，是最便宜的
 * 一道閘。上界取自最大合法訊息——可尋址快照事件 256KB（{@link ADDRESSABLE_MAX_BYTES}）
 * 加上 1024 個 author 的 REQ（約 70KB）都落在此值內。
 */
const MAX_MESSAGE_BYTES = 384 * 1024;

/**
 * 單顆事件序列化後的大小上限（ADR-0235 C3）。原本**只有** kind 1060 有大小檢查，其餘
 * kind（含 gift wrap）完全無界。對齊可尋址事件上限 256KB——那是協定內最大的合法事件。
 */
const MAX_EVENT_BYTES = 262_144;

/**
 * 單顆事件的 tag 總數上限（ADR-0235 C3）。外層事件的 tag 極少（`p`／`expiration`／`d`），
 * 128 已是數十倍餘裕。
 */
const MAX_TAGS = 128;

/**
 * 單顆事件的 `p` tag（收件人）數上限（ADR-0235 C3）。
 *
 * 客戶端的**外層**事件一律只有 **1 個** `p`——群組是逐位成員各發一顆 Gift Wrap（ADR-0027），
 * 多重提及的 `p` 在加密 rumor 內層、中繼根本看不到。16 留給未來，同時把
 * 「一則事件 → 15,000 列 INSERT ＋ 15,000 輪 enforceCap」的放大倍率壓回個位數。
 */
const MAX_P_TAGS = 16;
import {
  FILE_EVENT_MAX_BYTES,
  FILE_WRAP_KIND,
  isAddressableKind,
  isReplaceableOrAddressable,
  recipientsOf,
  type OfflineStore,
} from "./message-store.js";
import {
  parseClientMessage,
  type RelayFilter,
  type RelayMessage,
} from "./protocol.js";

const EPHEMERAL_MIN = 20000;
const EPHEMERAL_MAX = 29999;

/** NIP-01：20000–29999 為 Ephemeral，中繼站不得持久化。 */
export function isEphemeral(kind: number): boolean {
  return kind >= EPHEMERAL_MIN && kind <= EPHEMERAL_MAX;
}

/** NIP-13：event id（hex）開頭的零位元數（工作量證明難度）。 */
export function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const nibble = Number.parseInt(ch, 16);
    if (Number.isNaN(nibble)) break;
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(nibble) - 28;
    break;
  }
  return bits;
}

/** 要送往某連線的一則訊息。 */
export interface Outbound {
  to: string;
  message: RelayMessage;
}

/** 某連線的可序列化狀態快照（供 DO 休眠後還原；ADR-0059）。 */
export interface ConnSnapshot {
  connId: string;
  /** NIP-42 挑戰（未認證前）。 */
  challenge?: string;
  /** 已認證的 pubkey（認證後）。 */
  pubkey?: string;
  /** 本站主機（NIP-42 `relay` tag 比對用，ADR-0235 H2）；DO 休眠後需還原。 */
  relayHost?: string;
  /** 此連線目前的訂閱（subId + filters）。 */
  subs: { subId: string; filters: RelayFilter[] }[];
}

export interface RelayCoreOptions {
  /**
   * 離線留言持久層（M2）。Ephemeral 事件**絕不會**寫入此處，
   * 以保證上線狀態/心跳純記憶體轉發、不寫資料庫。
   */
  store?: OfflineStore;
  /** 取得目前 unix 秒（用於 NIP-40 過期判定）；預設為系統時鐘。 */
  now?: () => number;
  /** 每連線最大訂閱數；超過則拒絕新訂閱（防濫用）。 */
  maxSubscriptions?: number;
  /** 持久化事件所需的最小 NIP-13 PoW 難度（0 = 不要求）。 */
  minPowDifficulty?: number;
  /**
   * 允許的時鐘偏移（秒），**對稱**窗。
   *
   * @deprecated 對稱窗與 NIP-59 不相容（ADR-0235 H1）——外層 `created_at` 會被隨機往前推
   * 最多 `TIMESTAMP_JITTER_SECONDS`（2 天），對稱設一個小值會把幾乎每一則 Gift Wrap 擋掉。
   * 請改用 {@link maxFutureSkewSec} ／ {@link maxPastSkewSec}。設此值等同兩者都設為它。
   */
  maxClockSkewSec?: number;
  /**
   * 未來方向的時鐘容忍（秒；ADR-0235 H1）。**沒有任何合法事件會是未來的**，
   * 所以這個方向可以收得很緊，只留給客戶端時鐘誤差。
   */
  maxFutureSkewSec?: number;
  /**
   * 過去方向的時鐘容忍（秒；ADR-0235 H1）。**必須大於 `TIMESTAMP_JITTER_SECONDS`（2 天）**
   * ——NIP-59 刻意把外層時戳往前推以免中繼從時序關聯出社交圖譜，那是隱私設計而非異常。
   */
  maxPastSkewSec?: number;
  /**
   * 重放去重窗（秒；ADR-0235 H1）：只有 `created_at` 落在「現在 ± 此值」內的事件才進去重快取。
   *
   * 為什麼不涵蓋整個過去窗：那是 2 天份的 event id，DO 記憶體撐不住。而且對封裝事件也沒必要
   * ——收件端本來就以 `rumor.id` 去重（ARCHITECTURE §4）。真正需要擋的是**裸的即時信標**
   * （kind 20000 心跳，用真實時戳），重放它就能偽造「某人在線」。
   */
  replayWindowSec?: number;
  /**
   * 每個 pubkey 每分鐘可發布的事件數上限（ADR-0235 H1）。
   *
   * 修正前**完全沒有**速率限制：任何人自產一把金鑰通過 AUTH，就能對單一全域房間的 DO
   * 無限灌事件。以 pubkey（而非連線）計數——否則換條連線就繞過去了。
   */
  maxEventsPerMinute?: number;
  /**
   * 企業封閉模式（ADR-0044）：僅允許名單內 pubkey（hex）發布事件的 allowlist。
   * 未設＝開放中繼（現況）。設定後非名單成員的任何事件（含心跳）一律拒收，
   * 使「同一企業只用同一節點、外部客戶不進系統」在內容層成立。
   */
  allowedAuthors?: Iterable<string>;
  /**
   * 企業政策（ADR-0048）：僅轉發/儲存 kind 在此名單的事件；其餘拒收。
   * 未設＝不限制。停用檔案/通話＝從名單排除其信令 kind（無信令即無 WebRTC）。
   */
  allowedKinds?: Iterable<number>;
  /**
   * 接受檔案塊事件（FILE_WRAP=1060，ADR-0162）：企業站以 `MAX_FILE_MB` 啟用。
   * 未設/false＝整類拒收（公共站零儲存風險）。
   */
  acceptFileEvents?: boolean;
  /**
   * NIP-42 AUTH（開放中繼，ADR-0057）：開啟後連線須先回應 AUTH 挑戰才准讀寫；
   * 且帶 `#p` 的訂閱只能查自己的收件匣（認證 pubkey ∈ `#p`）。未設＝開放（現況）。
   * 企業模式維持 allowlist、不開此項（ADR-0044）。
   */
  requireAuth?: boolean;
  /** 產生 AUTH 挑戰字串（測試可注入以求確定性）；預設 `crypto.randomUUID()`。 */
  authChallenge?: () => string;
  /**
   * AUTH 事件的最大年齡（秒；ADR-0235 H2）。限制側錄到的簽名可被使用的時間窗。
   * 未設＝不檢查（維持原行為）。NIP-42 建議 10 分鐘。
   */
  authMaxAgeSec?: number;
}

interface SubEntry {
  connId: string;
  subId: string;
  filters: RelayFilter[];
  /** 此訂閱所有 filter 指定的 kind 聯集（用於索引）。 */
  kinds: number[];
  /** 是否有 filter 未限制 kind（可匹配任何 kind）。 */
  anyKind: boolean;
}

/**
 * 傳輸無關的中繼核心：管理各連線的訂閱、驗證事件並對符合的訂閱扇出。
 * 訂閱以 kind 建立反向索引，事件進來只比對「對該 kind 有興趣」的訂閱，
 * 避免每個事件掃過全體訂閱（O(N²)）。由 Worker / Durable Object 注入收發。
 */
export class RelayCore {
  /** connId -> (subId -> entry)，權威來源。 */
  private readonly subs = new Map<string, Map<string, SubEntry>>();
  /** kind -> 對該 kind 有興趣的訂閱。 */
  private readonly byKind = new Map<number, Set<SubEntry>>();
  /** 未限制 kind（可匹配任何 kind）的訂閱。 */
  private readonly anyKindSubs = new Set<SubEntry>();
  /** 已處理事件 id → created_at（重放窗內去重，防重放）。 */
  private readonly seenIds = new Map<string, number>();
  /** pubkey → 該時間窗內的發布數與窗起點（ADR-0235 H1 速率限制）。 */
  private readonly rate = new Map<string, { windowStart: number; count: number }>();
  /** 企業封閉模式的發布 allowlist（hex pubkey）；undefined＝開放（ADR-0044）。 */
  private readonly allowed: Set<string> | undefined;
  /** 企業政策的事件類型 allowlist（kind）；undefined＝不限制（ADR-0048）。 */
  private readonly allowedKinds: Set<number> | undefined;
  /** connId → NIP-42 認證狀態（挑戰、已認證 pubkey、本站主機）；ADR-0057／0235 H2。 */
  private readonly authState = new Map<string, { challenge: string; pubkey?: string; relayHost?: string }>();
  /** 是否要求 NIP-42 AUTH（開放中繼；ADR-0057）。 */
  private readonly requireAuth: boolean;

  constructor(private readonly opts: RelayCoreOptions = {}) {
    this.allowed = opts.allowedAuthors ? new Set(opts.allowedAuthors) : undefined;
    this.allowedKinds = opts.allowedKinds ? new Set(opts.allowedKinds) : undefined;
    this.requireAuth = opts.requireAuth === true;
  }

  private newChallenge(): string {
    return (this.opts.authChallenge ?? (() => crypto.randomUUID()))();
  }

  private isAuthed(connId: string): boolean {
    return this.authState.get(connId)?.pubkey !== undefined;
  }

  private now(): number {
    return this.opts.now?.() ?? Math.floor(Date.now() / 1000);
  }

  /**
   * 建立連線；`requireAuth` 時回 NIP-42 AUTH 挑戰供宿主送出（否則空）。
   *
   * `relayHost`＝**本次請求打到的主機**（宿主從 request 取得）。給了它，AUTH 就會驗證
   * `relay` tag 指向本站（ADR-0235 H2）；不給則不強制（自架／測試維持原行為）。
   * 由宿主提供而非設定檔：同一份 Worker 可能同時服務多個網域，寫死會誤擋。
   */
  connect(connId: string, relayHost?: string): Outbound[] {
    if (!this.subs.has(connId)) this.subs.set(connId, new Map());
    if (!this.requireAuth) return [];
    // 已有挑戰（含已認證）者只重發、不重置——避免重複呼叫把認證狀態洗掉。
    const existing = this.authState.get(connId);
    if (existing) return [{ to: connId, message: ["AUTH", existing.challenge] }];
    const challenge = this.newChallenge();
    this.authState.set(connId, { challenge, ...(relayHost ? { relayHost } : {}) });
    return [{ to: connId, message: ["AUTH", challenge] }];
  }

  disconnect(connId: string): void {
    const conn = this.subs.get(connId);
    if (conn) for (const entry of conn.values()) this.unindex(entry);
    this.subs.delete(connId);
    this.authState.delete(connId);
  }

  /**
   * 匯出某連線的可序列化狀態（訂閱＋認證）；供 DO 休眠後從 WebSocket attachment 還原
   * （ADR-0059）。休眠會清空記憶體，故每次狀態變動後宿主應存回此快照。
   */
  exportConn(connId: string): ConnSnapshot {
    const auth = this.authState.get(connId);
    const conn = this.subs.get(connId);
    const subs = conn ? [...conn.values()].map((e) => ({ subId: e.subId, filters: e.filters })) : [];
    return {
      connId,
      ...(auth?.challenge !== undefined ? { challenge: auth.challenge } : {}),
      ...(auth?.pubkey !== undefined ? { pubkey: auth.pubkey } : {}),
      // 少了這一行，DO 休眠喚醒後 `relayHost` 就消失 → relay tag 檢查靜默失效（ADR-0235 H2）。
      ...(auth?.relayHost !== undefined ? { relayHost: auth.relayHost } : {}),
      subs,
    };
  }

  /** 從快照還原連線狀態（重建訂閱索引與認證，不觸發任何送出）；休眠喚醒時呼叫（ADR-0059）。 */
  rehydrate(snapshot: ConnSnapshot): void {
    if (!this.subs.has(snapshot.connId)) this.subs.set(snapshot.connId, new Map());
    const conn = this.subs.get(snapshot.connId)!;
    if (snapshot.challenge !== undefined || snapshot.pubkey !== undefined || snapshot.relayHost !== undefined) {
      this.authState.set(snapshot.connId, {
        challenge: snapshot.challenge ?? "",
        ...(snapshot.pubkey !== undefined ? { pubkey: snapshot.pubkey } : {}),
        ...(snapshot.relayHost !== undefined ? { relayHost: snapshot.relayHost } : {}),
      });
    }
    for (const { subId, filters } of snapshot.subs) {
      const entry = buildEntry(snapshot.connId, subId, filters);
      conn.set(subId, entry);
      this.index(entry);
    }
  }

  /**
   * 客戶端訊息入口。**整段包在例外圍籬內**（ADR-0235 C1）：`RelayCore` 是傳輸無關核心，
   * 宿主（Cloudflare DO / Node ws）各自 try/catch 只會漏掉其中一邊，且 DO 的未捕捉例外
   * 會中止整個 Durable Object——那是**單一全域房間**，等於全站連線一起斷。圍籬放在唯一
   * 入口，兩個宿主自動受保護。
   */
  handle(connId: string, raw: string): Outbound[] {
    try {
      return this.dispatch(connId, raw);
    } catch {
      // 不回傳例外細節（不給探測訊號）；宿主連線維持存活。
      return [{ to: connId, message: ["NOTICE", "error: 內部錯誤，請稍後再試"] }];
    }
  }

  private dispatch(connId: string, raw: string): Outbound[] {
    // 最便宜的一道閘（ADR-0235 C3）：在 JSON.parse 之前擋掉超大訊息。
    if (raw.length > MAX_MESSAGE_BYTES) {
      return [{ to: connId, message: ["NOTICE", "invalid: 訊息過大"] }];
    }
    const msg = parseClientMessage(raw);
    switch (msg.type) {
      case "AUTH":
        return this.handleAuth(connId, msg.event);
      case "EVENT":
        if (this.requireAuth && !this.isAuthed(connId)) {
          return this.authRequired(connId, ["OK", msg.event.id, false, "auth-required: 請先認證（NIP-42）"]);
        }
        return this.handleEvent(connId, msg.event);
      case "REQ":
        if (this.requireAuth && !this.isAuthed(connId)) {
          return this.authRequired(connId, ["CLOSED", msg.subId, "auth-required: 請先認證（NIP-42）"]);
        }
        if (this.requireAuth && !this.scoped(connId, msg.filters)) {
          // 訊息要**說得出原因**（ADR-0123）：沉默的空回應會讓實作者以為「這個中繼沒有資料」，
          // 然後跑去別的地方找 bug。
          return [
            {
              to: connId,
              message: ["CLOSED", msg.subId, "restricted: 訂閱必須指定 #p（自己）或 authors（ADR-0123）"],
            },
          ];
        }
        return this.handleReq(connId, msg.subId, msg.filters);
      case "CLOSE": {
        const conn = this.subs.get(connId);
        const entry = conn?.get(msg.subId);
        if (entry) {
          this.unindex(entry);
          conn?.delete(msg.subId);
        }
        return [{ to: connId, message: ["CLOSED", msg.subId, ""] }];
      }
      case "INVALID":
        return [{ to: connId, message: ["NOTICE", `invalid: ${msg.reason}`] }];
    }
  }

  /**
   * 處理客戶端的 NIP-42 AUTH 回應：驗簽 ＋ kind ＋ 挑戰相符 ＋ **`relay` tag 指向本站**
   * ＋ 事件新鮮度 → 標記此連線認證身分。
   *
   * `relay` tag 那一項是 NIP-42 規範要求、而修正前**沒有做**的檢查（ADR-0235 H2）。
   * 少了它，惡意中繼 M 可以：連上真中繼 R 取得挑戰 C → 把 C 當成自己的挑戰丟給受害者 →
   * 受害者簽名回給 M → M 轉送給 R → **以受害者身分通過 R 的認證**，進而訂閱其加密收件匣。
   * 內容仍是密文，但「誰在何時收到幾則」已是完整的流量分析輸入。
   */
  private handleAuth(connId: string, event: NostrEvent): Outbound[] {
    const state = this.authState.get(connId);
    if (!state) {
      return [{ to: connId, message: ["OK", event.id, false, "auth-failed: 尚未發出挑戰"] }];
    }
    if (event.kind !== AUTH_KIND || !verifyEvent(event) || authChallengeOf(event) !== state.challenge) {
      return [{ to: connId, message: ["OK", event.id, false, "auth-failed: 認證事件無效或挑戰不符"] }];
    }
    if (state.relayHost !== undefined && !authRelayMatches(event, state.relayHost)) {
      return [{ to: connId, message: ["OK", event.id, false, "auth-failed: relay tag 未指向本站"] }];
    }
    const maxAge = this.opts.authMaxAgeSec;
    if (maxAge !== undefined && Math.abs(this.now() - event.created_at) > maxAge) {
      return [{ to: connId, message: ["OK", event.id, false, "auth-failed: 認證事件已過期"] }];
    }
    state.pubkey = event.pubkey;
    return [{ to: connId, message: ["OK", event.id, true, ""] }];
  }

  /** 未認證時回拒絕訊息並（重）發此連線的 AUTH 挑戰。 */
  private authRequired(connId: string, rejection: RelayMessage): Outbound[] {
    const out: Outbound[] = [{ to: connId, message: rejection }];
    const state = this.authState.get(connId);
    if (state) out.push({ to: connId, message: ["AUTH", state.challenge] });
    return out;
  }

  /**
   * 訂閱必須**具名**（ADR-0123）：帶 `#p`（等於自己）或帶非空且有界的 `authors`。
   *
   * ## 修正前的缺口
   *
   * 舊版只檢查「有 `#p` 的 filter」：
   *
   * ```ts
   * const pValues = filter["#p"];
   * if (pValues && pValues.length > 0 && !pValues.every((v) => v === self)) return false;
   * ```
   *
   * **`pValues` 是 undefined 就直接放行。** 於是 `{"kinds":[20000]}`——沒有 `#p`、沒有
   * `authors`——完全合法，任何通過 AUTH 的人（隨手產一把金鑰就能通過）都能拿到**全站每一則
   * 心跳**：每個在線者的 pubkey、狀態訊息、正在聽什麼（ADR-0088 F5 把音樂併進了心跳）。
   *
   * 那不是「洩漏某個人的元資料」，是把整個使用者名冊連同即時線上狀態做成一支**消防水管**
   * ——攻擊者不需要事先知道任何 pubkey。`{"kinds":[1059]}` 同理：拿不到明文，但拿得到
   * 全站的收件人 p-tag 與時間分布（流量分析的完美輸入）。
   *
   * ## 為什麼可以直接擋掉
   *
   * 合法客戶端**從不**送這種 filter——引擎的 9 個 filter 全部帶 `#p` 或 `authors`。
   * 一個不會影響任何合法用法的限制，就該加上去。
   *
   * 「具名」的意思是：**你得先知道要問誰**。這不是完美的隱私（仍可訂閱任何已知 pubkey 的
   * 心跳——那是 Nostr 廣播式 presence 的固有性質，見 ADR-0120/0123 的已知限制），
   * 但它把攻擊從「一鍵拿到整個名冊」降級為「一次問一個你已經知道的人」。
   */
  private scoped(connId: string, filters: RelayFilter[]): boolean {
    const self = this.authState.get(connId)?.pubkey;
    for (const filter of filters) {
      const pValues = filter["#p"];
      if (pValues && pValues.length > 0) {
        if (!pValues.every((v) => v === self)) return false; // 只能查自己的收件匣（ADR-0057）
        continue;
      }
      const authors = filter.authors;
      // 該擋的是 `authors` **不存在**（＝不過濾作者＝全站）。
      //
      // `authors: []` 是**合法且無害的**：`matchFilter` 的 `!filter.authors.includes(pubkey)`
      // 對空陣列恆為真 → 匹配不到任何事件。而引擎在「還沒有任何聯絡人」時送出的正是它
      //（心跳訂閱的 authors 就是聯絡人清單）。把它當成消防水管擋下來，會讓新使用者
      //**整個 REQ 被拒 → 什麼都收不到**。
      if (!authors) return false; // ← 消防水管
      // 也不准用 `authors: [十萬把金鑰]` 繞過——那等價於枚舉全站。
      // 1024 遠大於任何真實聯絡人清單／組織名冊。
      if (authors.length > MAX_AUTHORS) return false;
    }
    return true;
  }

  private handleReq(connId: string, subId: string, filters: RelayFilter[]): Outbound[] {
    if (!this.subs.has(connId)) this.subs.set(connId, new Map()); // 確保連線存在，不碰 AUTH 狀態
    const conn = this.subs.get(connId)!;

    const cap = this.opts.maxSubscriptions;
    if (cap !== undefined && !conn.has(subId) && conn.size >= cap) {
      return [{ to: connId, message: ["CLOSED", subId, "rate-limited: 訂閱數已達上限"] }];
    }

    const previous = conn.get(subId);
    if (previous) this.unindex(previous);
    const entry = buildEntry(connId, subId, filters);
    conn.set(subId, entry);
    this.index(entry);

    const out: Outbound[] = [];
    if (this.opts.store) {
      const nowSec = this.now();
      const seen = new Set<string>();
      const self = this.authState.get(connId)?.pubkey;
      for (const filter of filters) {
        for (const event of this.opts.store.query(filter, nowSec)) {
          if (seen.has(event.id)) continue;
          // ADR-0071：快照（可尋址密文）只回給作者本人（requireAuth 時）——不論 filter 形狀。
          if (this.requireAuth && isAddressableKind(event.kind) && event.pubkey !== self) continue;
          seen.add(event.id);
          out.push({ to: connId, message: ["EVENT", subId, event] });
        }
      }
    }
    out.push({ to: connId, message: ["EOSE", subId] });
    return out;
  }

  private handleEvent(connId: string, event: NostrEvent): Outbound[] {
    // 資源上限（ADR-0235 C3）擺在**驗簽之前**——這些檢查比 Schnorr 驗證便宜一個數量級，
    // 讓灌大量垃圾的攻擊者付不出放大效果。
    if (event.tags.length > MAX_TAGS) {
      return [{ to: connId, message: ["OK", event.id, false, "blocked: tag 數超過上限"] }];
    }
    if (recipientsOf(event).length > MAX_P_TAGS) {
      return [{ to: connId, message: ["OK", event.id, false, "blocked: 收件人數超過上限"] }];
    }
    if (JSON.stringify(event).length > MAX_EVENT_BYTES) {
      return [{ to: connId, message: ["OK", event.id, false, "blocked: 事件過大"] }];
    }

    if (!verifyEvent(event)) {
      return [{ to: connId, message: ["OK", event.id, false, "invalid: 簽章驗證失敗"] }];
    }

    // 企業封閉模式（ADR-0044）：非 allowlist 成員一律拒收（含心跳），永久性拒絕。
    if (this.allowed && !this.allowed.has(event.pubkey)) {
      return [{ to: connId, message: ["OK", event.id, false, "blocked: 非本企業成員（allowlist）"] }];
    }

    // 企業政策（ADR-0048）：kind 不在允許名單一律拒收（停用檔案/通話等）。
    if (this.allowedKinds && !this.allowedKinds.has(event.kind)) {
      return [{ to: connId, message: ["OK", event.id, false, "blocked: 此事件類型已被政策停用"] }];
    }

    // 時鐘窗（非對稱，ADR-0235 H1）＋重放去重（近期事件才進快取）。
    const now = this.now();
    const future = this.opts.maxFutureSkewSec ?? this.opts.maxClockSkewSec;
    const past = this.opts.maxPastSkewSec ?? this.opts.maxClockSkewSec;
    if (
      (future !== undefined && event.created_at - now > future) ||
      (past !== undefined && now - event.created_at > past)
    ) {
      return [{ to: connId, message: ["OK", event.id, false, "invalid: 時間戳超出允許範圍"] }];
    }
    // 舊的 `maxClockSkewSec` 同時兼具「時鐘窗」與「去重窗」兩種語意——沿用它作為
    // `replayWindowSec` 的預設值，既有呼叫端行為不變。
    const replayWindow = this.opts.replayWindowSec ?? this.opts.maxClockSkewSec;
    if (replayWindow !== undefined && Math.abs(event.created_at - now) <= replayWindow) {
      if (this.seenIds.has(event.id)) {
        return [{ to: connId, message: ["OK", event.id, false, "duplicate: 事件重複"] }];
      }
      this.seenIds.set(event.id, event.created_at);
      if (this.seenIds.size > 4096) this.pruneSeen(now - replayWindow);
    }

    // 速率限制（ADR-0235 H1）：以 pubkey 計，換連線繞不過。放在驗簽之後——pubkey 必須
    // 是**經證明**的，否則任何人都能冒用別人的 pubkey 把對方的配額燒光。
    const perMinute = this.opts.maxEventsPerMinute;
    if (perMinute !== undefined && !this.allowRate(event.pubkey, now, perMinute)) {
      return [{ to: connId, message: ["OK", event.id, false, "rate-limited: 發送過於頻繁，請稍後再試"] }];
    }

    // 檔案塊（FILE_WRAP=1060，ADR-0162）：企業限定——`acceptFileEvents` 未啟用整類拒收
    //（公共站零儲存風險）；啟用後仍有單顆大小 sanity 上限。
    if (event.kind === FILE_WRAP_KIND) {
      if (!this.opts.acceptFileEvents) {
        return [{ to: connId, message: ["OK", event.id, false, "blocked: 檔案事件未啟用（MAX_FILE_MB）"] }];
      }
      if (JSON.stringify(event).length > FILE_EVENT_MAX_BYTES) {
        return [{ to: connId, message: ["OK", event.id, false, "blocked: 檔案塊過大"] }];
      }
    }

    // Ephemeral 純轉發、不寫 D1；其餘（持久化）需通過 PoW 並寫入持久層。
    if (!isEphemeral(event.kind)) {
      const minPow = this.opts.minPowDifficulty ?? 0;
      if (minPow > 0 && leadingZeroBits(event.id) < minPow) {
        return [{ to: connId, message: ["OK", event.id, false, `pow: 需要難度 ${minPow}`] }];
      }
      if (isReplaceableOrAddressable(event.kind)) {
        // 取代語意（ADR-0035 可取代／0071 可尋址）：每 (kind, pubkey, d) 只留最新一顆。
        // 沒有這條，relay 清單（10037）這類事件會不斷累積——cron 每小時發一次，
        // 客戶端每次連線就得下載上百份重複。遭拒＝OK false（不扇出）。
        if (this.opts.store && !this.opts.store.putAddressable(event, this.now())) {
          return [{ to: connId, message: ["OK", event.id, false, "blocked: 取代事件遭拒（配額/大小/較舊）"] }];
        }
      } else {
        this.opts.store?.put(event, this.now());
      }
    }

    const out: Outbound[] = [{ to: connId, message: ["OK", event.id, true, ""] }];
    const candidates = new Set<SubEntry>(this.byKind.get(event.kind));
    for (const entry of this.anyKindSubs) candidates.add(entry);
    for (const entry of candidates) {
      // ADR-0071：快照（可尋址密文）只回給作者本人——requireAuth 時即時扇出也閘門。
      if (this.requireAuth && isAddressableKind(event.kind) && this.authState.get(entry.connId)?.pubkey !== event.pubkey) {
        continue;
      }
      if (entry.filters.some((f) => matchFilter(f, event))) {
        out.push({ to: entry.connId, message: ["EVENT", entry.subId, event] });
      }
    }
    return out;
  }

  private index(entry: SubEntry): void {
    for (const kind of entry.kinds) {
      let set = this.byKind.get(kind);
      if (!set) {
        set = new Set();
        this.byKind.set(kind, set);
      }
      set.add(entry);
    }
    if (entry.anyKind) this.anyKindSubs.add(entry);
  }

  /** 移除重放窗外、不再可能重放的已見 id，避免無限成長。 */
  private pruneSeen(cutoffSec: number): void {
    for (const [id, createdAt] of this.seenIds) {
      if (createdAt < cutoffSec) this.seenIds.delete(id);
    }
  }

  /**
   * 固定時間窗計數（ADR-0235 H1）：同一 pubkey 在 60 秒窗內超過上限即拒。
   *
   * 刻意用固定窗而非令牌桶：DO 會在訊息之間休眠，記憶體狀態隨時可能消失——複雜的
   * 累積式演算法在這種環境下只是假象。固定窗即使被休眠重置，也仍然把「單次爆量」
   * 壓在上限以內，而那正是要防的東西。
   */
  private allowRate(pubkey: string, nowSec: number, perMinute: number): boolean {
    const entry = this.rate.get(pubkey);
    if (!entry || nowSec - entry.windowStart >= 60) {
      this.rate.set(pubkey, { windowStart: nowSec, count: 1 });
      // 順帶清掉早已過窗的條目，避免 map 隨著陌生 pubkey 無限成長。
      if (this.rate.size > 4096) {
        for (const [pk, e] of this.rate) if (nowSec - e.windowStart >= 60) this.rate.delete(pk);
      }
      return true;
    }
    if (entry.count >= perMinute) return false;
    entry.count += 1;
    return true;
  }

  private unindex(entry: SubEntry): void {
    for (const kind of entry.kinds) {
      const set = this.byKind.get(kind);
      if (set) {
        set.delete(entry);
        if (set.size === 0) this.byKind.delete(kind);
      }
    }
    this.anyKindSubs.delete(entry);
  }
}

function buildEntry(connId: string, subId: string, filters: RelayFilter[]): SubEntry {
  const kinds = new Set<number>();
  let anyKind = false;
  for (const filter of filters) {
    if (filter.kinds && filter.kinds.length > 0) {
      for (const kind of filter.kinds) kinds.add(kind);
    } else {
      anyKind = true;
    }
  }
  return { connId, subId, filters, kinds: [...kinds], anyKind };
}
