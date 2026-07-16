import { AUTH_KIND, authChallengeOf, verifyEvent, type NostrEvent } from "@cinder/core";
import { matchFilter } from "./filters.js";

/**
 * 單一 filter 的 `authors` 上限（ADR-0123）：擋掉「用 `authors: [十萬把金鑰]` 枚舉全站」。
 * 1024 遠大於任何真實聯絡人清單／組織名冊，也遠小於枚舉所需。
 */
const MAX_AUTHORS = 1024;
import { FILE_EVENT_MAX_BYTES, FILE_WRAP_KIND, isAddressableKind, isReplaceableOrAddressable, type OfflineStore } from "./message-store.js";
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
   * 允許的時鐘偏移（秒）。設定後：拒收 `created_at` 偏離本機時鐘超過此值的
   * 事件，並在此時間窗內以 event id 去重（防重放偽造上線/重送舊 SDP）。
   * 未設定時不啟用（維持原行為）。
   */
  maxClockSkewSec?: number;
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
  /** 已處理事件 id → created_at（時鐘窗內去重，防重放）。 */
  private readonly seenIds = new Map<string, number>();
  /** 企業封閉模式的發布 allowlist（hex pubkey）；undefined＝開放（ADR-0044）。 */
  private readonly allowed: Set<string> | undefined;
  /** 企業政策的事件類型 allowlist（kind）；undefined＝不限制（ADR-0048）。 */
  private readonly allowedKinds: Set<number> | undefined;
  /** connId → NIP-42 認證狀態（此連線的挑戰與已認證 pubkey）；ADR-0057。 */
  private readonly authState = new Map<string, { challenge: string; pubkey?: string }>();
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

  /** 建立連線；`requireAuth` 時回 NIP-42 AUTH 挑戰供宿主送出（否則空）。 */
  connect(connId: string): Outbound[] {
    if (!this.subs.has(connId)) this.subs.set(connId, new Map());
    if (!this.requireAuth) return [];
    // 已有挑戰（含已認證）者只重發、不重置——避免重複呼叫把認證狀態洗掉。
    const existing = this.authState.get(connId);
    if (existing) return [{ to: connId, message: ["AUTH", existing.challenge] }];
    const challenge = this.newChallenge();
    this.authState.set(connId, { challenge });
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
      subs,
    };
  }

  /** 從快照還原連線狀態（重建訂閱索引與認證，不觸發任何送出）；休眠喚醒時呼叫（ADR-0059）。 */
  rehydrate(snapshot: ConnSnapshot): void {
    if (!this.subs.has(snapshot.connId)) this.subs.set(snapshot.connId, new Map());
    const conn = this.subs.get(snapshot.connId)!;
    if (snapshot.challenge !== undefined || snapshot.pubkey !== undefined) {
      this.authState.set(snapshot.connId, {
        challenge: snapshot.challenge ?? "",
        ...(snapshot.pubkey !== undefined ? { pubkey: snapshot.pubkey } : {}),
      });
    }
    for (const { subId, filters } of snapshot.subs) {
      const entry = buildEntry(snapshot.connId, subId, filters);
      conn.set(subId, entry);
      this.index(entry);
    }
  }

  handle(connId: string, raw: string): Outbound[] {
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

  /** 處理客戶端的 NIP-42 AUTH 回應：驗簽 + kind + 挑戰相符 → 標記此連線認證身分。 */
  private handleAuth(connId: string, event: NostrEvent): Outbound[] {
    const state = this.authState.get(connId);
    if (!state) {
      return [{ to: connId, message: ["OK", event.id, false, "auth-failed: 尚未發出挑戰"] }];
    }
    if (event.kind !== AUTH_KIND || !verifyEvent(event) || authChallengeOf(event) !== state.challenge) {
      return [{ to: connId, message: ["OK", event.id, false, "auth-failed: 認證事件無效或挑戰不符"] }];
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

    // C2：時鐘偏移與重放防護（啟用時）。
    const skew = this.opts.maxClockSkewSec;
    if (skew !== undefined) {
      const now = this.now();
      if (Math.abs(event.created_at - now) > skew) {
        return [{ to: connId, message: ["OK", event.id, false, "invalid: 時間戳超出允許範圍"] }];
      }
      if (this.seenIds.has(event.id)) {
        return [{ to: connId, message: ["OK", event.id, false, "duplicate: 事件重複"] }];
      }
      this.seenIds.set(event.id, event.created_at);
      if (this.seenIds.size > 1024) this.pruneSeen(now - skew);
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

  /** 移除時鐘窗外、不再可能重放的已見 id，避免無限成長。 */
  private pruneSeen(cutoffSec: number): void {
    for (const [id, createdAt] of this.seenIds) {
      if (createdAt < cutoffSec) this.seenIds.delete(id);
    }
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
