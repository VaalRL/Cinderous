// NIP-11 Relay Information Document（ADR-0256，承接 ADR-0089／0092 的未竟待辦）。
//
// ## 為什麼這份檔案存在
//
// ADR-0089（營運者贊助入口）與 ADR-0092（節點自報 `cinder_node`）**都建立在「relay 能回一份
// NIP-11 文件」之上**，但兩座宿主過去對 HTTP GET 一律只回純文字 `"Cinderous relay"`。於是：
//
// - 社群營運者**沒有任何收入面**（贊助連結無處可放，見 ADR-0253 §2）；
// - 節點申請流程（ADR-0092）缺了它指定的載體；
// - 客戶端要知道站方政策（TTL／檔案／速率）只能**送出去被拒才知道**。
//
// 這不是新決策，是把已接受的決策做完。
//
// ## 契約：只有明確要 JSON 的人才拿得到 JSON
//
// 依 `Accept: application/nostr+json` 分支；**不帶此 header 時維持原純文字 200**——PaaS／
// 容器健康檢查（ADR-0075）與既有探測都靠那個 200，改掉會讓部署中的站看起來像掛了。

import { MAX_EVENTS_PER_MINUTE, MAX_PER_RECIPIENT, MAX_SUBSCRIPTIONS, ttlSecondsFromDays } from "./host-config.js";
import { ADDRESSABLE_MAX_BYTES, DEFAULT_MAX_TTL_SECONDS, MAX_QUERY_ROWS } from "./message-store.js";

/** NIP-11 的 media type；只有帶這個 `Accept` 的請求才拿到 JSON。 */
export const NIP11_MEDIA_TYPE = "application/nostr+json";

/**
 * 本站**實際強制**的 NIP。
 *
 * 刻意只列「relay 這一層真的做了事」的：NIP-17／25／09／59 等是**客戶端**語意（中繼看到的
 * 只是密文外殼），列上去等於對外謊報能力。誠實的清單讓探測器與客戶端能信任它。
 *
 * - 01：事件／簽章／REQ／EOSE
 * - 11：本文件
 * - 13：PoW（`minPowDifficulty`）
 * - 40：過期時戳（＋站方 TTL 上限，ADR-0065）
 * - 42：AUTH（預設開，ADR-0057）
 * - 62：Request to Vanish（ADR-0256）
 */
export const SUPPORTED_NIPS = [1, 11, 13, 40, 42, 62] as const;

/** 營運者可填的贊助管道（ADR-0089）；全空＝不顯示贊助入口。 */
export interface CinderDonations {
  github_sponsors?: string | undefined;
  buy_me_a_coffee?: string | undefined;
  liberapay?: string | undefined;
  lightning?: string | undefined;
}

/** 組裝 NIP-11 文件所需的站方設定（由各宿主從自己的環境變數取得）。 */
export interface Nip11Config {
  name?: string | undefined;
  description?: string | undefined;
  /** 營運者公鑰（hex）。 */
  pubkey?: string | undefined;
  contact?: string | undefined;
  /** 站方 TTL 上限原始字串（`MAX_TTL_DAYS`）；未設＝預設 7 天。 */
  maxTtlDays?: string | undefined;
  /** 是否接受檔案塊（`MAX_FILE_MB` 已啟用；ADR-0162）。 */
  acceptsFiles?: boolean | undefined;
  /** 是否要求 NIP-42 AUTH。 */
  authRequired?: boolean | undefined;
  /** 贊助管道（ADR-0089）。 */
  donations?: CinderDonations | undefined;
  /** 節點自報（ADR-0092）：已簽章的 `CinderNodeDeclaration` 事件（JSON 字串）。 */
  nodeAttestation?: string | undefined;
  software?: string | undefined;
  version?: string | undefined;
}

/** 去掉值為 undefined／空字串的欄位；全空的物件本身也一併拿掉。 */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * 組出 NIP-11 文件。**未設定的欄位一律不出現**（而非填佔位字串）——一份宣稱
 * `contact: ""` 的文件比沒有 contact 更糟：它讓「有沒有人可問責」這件事變得模糊。
 */
export function buildRelayInfo(cfg: Nip11Config = {}): Record<string, unknown> {
  const ttlSeconds = ttlSecondsFromDays(cfg.maxTtlDays) ?? DEFAULT_MAX_TTL_SECONDS;
  const donations = compact({ ...(cfg.donations ?? {}) });

  let nodeAttestation: unknown;
  if (cfg.nodeAttestation) {
    try {
      nodeAttestation = JSON.parse(cfg.nodeAttestation); // 壞 JSON 就當沒設，不讓整份文件掛掉
    } catch {
      nodeAttestation = undefined;
    }
  }

  return compact({
    name: cfg.name ?? "Cinderous relay",
    description:
      cfg.description ??
      "Cinderous 中繼站：只轉發密文的 Nostr relay（Ephemeral 純轉發、NIP-40 有界保留）。",
    pubkey: cfg.pubkey,
    contact: cfg.contact,
    supported_nips: [...SUPPORTED_NIPS],
    software: cfg.software ?? "https://github.com/VaalRL/Cinderous",
    version: cfg.version,
    /**
     * 站方硬性限制——把「送出去被拒才知道」變成「連線前就知道」。
     * 值全部取自實際生效的常數，不是另抄一份（抄一份就會漂移）。
     */
    limitation: compact({
      max_subscriptions: MAX_SUBSCRIPTIONS,
      max_limit: MAX_QUERY_ROWS,
      max_message_length: ADDRESSABLE_MAX_BYTES,
      auth_required: cfg.authRequired === true,
      payment_required: false, // 本專案不做站內金流（PRD §12）
      restricted_writes: cfg.authRequired === true,
    }),
    retention: [{ time: ttlSeconds }],
    /** 每 pubkey 每分鐘事件上限（ADR-0235 H1）；非 NIP-11 標準欄位，故加前綴。 */
    cinder_max_events_per_minute: MAX_EVENTS_PER_MINUTE,
    /** 每收件人離線留言上限（PRD §8）。 */
    cinder_max_per_recipient: MAX_PER_RECIPIENT,
    /** 是否接受檔案塊（ADR-0162）：false＝整類拒收，客戶端不必試。 */
    cinder_accepts_files: cfg.acceptsFiles === true,
    /** 營運者自報的贊助管道（ADR-0089）；全空則整個欄位不出現＝無贊助入口。 */
    ...(Object.keys(donations).length > 0 ? { cinder_donations: donations } : {}),
    /** 營運者簽章的節點自報（ADR-0092）；供維護者工具拉取驗簽。 */
    ...(nodeAttestation !== undefined ? { cinder_node: nodeAttestation } : {}),
  });
}

/** 請求是否在要 NIP-11 文件（`Accept: application/nostr+json`）。 */
export function wantsRelayInfo(accept: string | null | undefined): boolean {
  return typeof accept === "string" && accept.toLowerCase().includes(NIP11_MEDIA_TYPE);
}

/** NIP-11 回應的標頭（含 CORS——瀏覽器版客戶端要跨源抓，比照 `/turn`）。 */
export const NIP11_HEADERS = {
  "content-type": `${NIP11_MEDIA_TYPE}; charset=utf-8`,
  "Access-Control-Allow-Origin": "*",
} as const;
