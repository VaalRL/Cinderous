// NIP-11 Relay Information Document 的抓取與解析（ADR-0262，承接 ADR-0089 後續行動 2）。
//
// 用途：讀出營運者自報的贊助管道（`cinder_donations`），供桌面顯示「贊助此節點」角落卡。
// 中繼端的文件產生見 `relay/src/nip11.ts`（ADR-0260）。
//
// ## 這裡的每個值都是「不可信輸入」
//
// 文件由**中繼站營運者**提供，而威脅模型把 relay 當對手（PRD §7）。所以：
//
// - **只收白名單 scheme**：`https:`（三個贊助平台）與 `lightning:`（LN 位址/LNURL）。
//   `javascript:`／`data:`／`file:` 之類一律丟棄——這張卡的每個項目最終都會變成一個可點的
//   連結，而「營運者可控的字串直接變成 href」正是 XSS 與釣魚的入口。
// - **長度有界**：畸形/超長值不進 UI。
// - **抓不到＝沒有**：任何網路或解析失敗都回 undefined，絕不讓贊助卡的抓取影響通訊。

/** 注入用的最小 fetch 介面（與 `turn-fetch.ts` 同款，測試好替身）。 */
export interface RelayInfoResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type RelayInfoFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<RelayInfoResponse>;

const defaultFetch: RelayInfoFetch = (url, init) => (globalThis.fetch as unknown as RelayInfoFetch)(url, init);

/** 單一贊助連結的長度上限（遠大於任何真實連結，只擋畸形）。 */
const MAX_URL_LEN = 512;

/** 贊助管道（ADR-0089）：四者皆選填，全空＝無贊助入口。 */
export interface CinderDonations {
  github_sponsors?: string;
  buy_me_a_coffee?: string;
  liberapay?: string;
  lightning?: string;
}

/** 贊助卡要顯示的一個項目。 */
export interface DonationLink {
  /** 管道鍵（決定 i18n 標籤與圖示）。 */
  channel: keyof CinderDonations;
  /** 已通過 scheme 白名單的可點連結。 */
  url: string;
}

/**
 * 三個網頁平台只收 `https:`——**刻意不收 `http:`**：贊助連結會把使用者導向輸入付款資訊的頁面，
 * 明文連線在這個情境沒有任何可接受的理由。
 */
function safeWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > MAX_URL_LEN) return undefined;
  try {
    return new URL(v).protocol.toLowerCase() === "https:" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `lightning` 欄位可以是 LN 位址（`user@domain`）或 LNURL（`lnurl1…`），也可能已經帶
 * `lightning:` 前綴。一律正規化成 `lightning:` deep link 交給外部錢包——App 不解析金額、
 * 不代付、不做站內付款（ADR-0089 決策 1）。
 */
function safeLightning(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > MAX_URL_LEN) return undefined;
  const body = /^lightning:/i.test(v) ? v.slice("lightning:".length) : v;
  // LN 位址或 LNURL/bech32：保守字元集，擋掉夾帶空白或協定分隔符的怪值。
  if (!/^[a-z0-9._@+-]+$/i.test(body)) return undefined;
  return `lightning:${body}`;
}

/**
 * 從 NIP-11 文件取出可顯示的贊助項目；沒有任何合法項目時回 `[]`（＝不顯示卡片）。
 * 順序固定，不隨文件的鍵順序跳動。
 */
export function parseDonations(doc: unknown): DonationLink[] {
  if (!doc || typeof doc !== "object") return [];
  const raw = (doc as { cinder_donations?: unknown }).cinder_donations;
  if (!raw || typeof raw !== "object") return [];
  const d = raw as Record<string, unknown>;
  const out: DonationLink[] = [];
  for (const channel of ["github_sponsors", "buy_me_a_coffee", "liberapay"] as const) {
    const url = safeWebUrl(d[channel]);
    if (url) out.push({ channel, url });
  }
  const ln = safeLightning(d.lightning);
  if (ln) out.push({ channel: "lightning", url: ln });
  return out;
}

/** 營運者自報的節點資訊（只取贊助卡用得到的欄位）。 */
export interface RelayInfo {
  /** 站名（營運者自報；UI 須框為「此節點聲稱」）。 */
  name?: string;
  donations: DonationLink[];
}

/** 站名長度上限（UI 只用來標示是哪一座，過長即忽略）。 */
const MAX_NAME_LEN = 64;

/** 解析 NIP-11 文件為 UI 需要的形狀。無合法贊助項目時回 undefined（呼叫端據此不顯示卡片）。 */
export function parseRelayInfo(doc: unknown): RelayInfo | undefined {
  const donations = parseDonations(doc);
  if (donations.length === 0) return undefined;
  const rawName = (doc as { name?: unknown } | null)?.name;
  const name = typeof rawName === "string" && rawName.trim() && rawName.length <= MAX_NAME_LEN ? rawName.trim() : undefined;
  return { donations, ...(name ? { name } : {}) };
}

/** 由 relay URL（`wss://host`）推導其 NIP-11 端點（`https://host/`）。非 ws(s) → undefined。 */
export function relayInfoEndpoint(relayUrl: string | undefined): string | undefined {
  const u = relayUrl?.trim();
  if (!u || !/^wss?:\/\//i.test(u)) return undefined;
  try {
    const parsed = new URL(u);
    const scheme = parsed.protocol.toLowerCase() === "wss:" ? "https:" : "http:";
    return `${scheme}//${parsed.host.toLowerCase()}/`;
  } catch {
    return undefined;
  }
}

/**
 * 抓某座 relay 的 NIP-11 文件並取出贊助資訊。
 *
 * 任何失敗（離線、非 2xx、非 JSON、沒有合法贊助項目）→ **undefined**。贊助卡是純加分功能，
 * 它的抓取絕不能影響通訊，也不該在 UI 上留下錯誤痕跡。
 */
export async function fetchRelayInfo(
  relayUrl: string,
  fetchFn: RelayInfoFetch = defaultFetch,
): Promise<RelayInfo | undefined> {
  const endpoint = relayInfoEndpoint(relayUrl);
  if (!endpoint) return undefined;
  try {
    const res = await fetchFn(endpoint, { method: "GET", headers: { Accept: "application/nostr+json" } });
    if (!res.ok) return undefined;
    return parseRelayInfo(await res.json());
  } catch {
    return undefined;
  }
}
