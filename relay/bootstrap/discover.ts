// NIP-66 relay 發現：把候選來源自動化，**但不自動收錄**（ADR-0366 P2 #12）。
//
// ## 這個模組解決的是哪一段
//
// 既有的收錄鏈是：`relays.json`（候選）→ `conformance.ts` 黑箱探測（ADR-0092）→
// `evaluateAdmission` 分級 → 維護者**離線簽章**成 kind 10037（ADR-0239）。
// 這條鏈最前面那一段——**候選從哪來**——至今是人工維護的，`relays.json` 只有兩筆。
//
// NIP-66（kind 30166 relay 發現事件 / 10166 監測者公告）正是這件事的標準。
// 它的 `["R","!payment"]` 直接給了「免費節點」這個條件，不必自己掃全網跑探針
// ——那正是四份遊戲規格想用 NIP-11 做、而 NIP-11 做不到的事（NIP-11 只能描述、不能發現）。
//
// ## 🔴 為什麼只產出候選，不寫回 `relays.json`
//
// `docs/research/public-relay-fallback.md` §5 已經下過定論：把來路不明的公共站混進
// **維護者簽章的清單**，「等於替它們背書，也稀釋那份簽章的意義」。而 NIP-66 自己也寫著
// 「Clients SHOULD NOT trust a single source」——監測者可能因設定錯誤或惡意而發假資料。
//
// ⇒ 本模組是**讀取與整理**，輸出一份給人看的候選清單。要不要放進 `relays.json`
// 由維護者決定，之後照樣走完整的探測與分級。發現交給網路，背書仍由人負責。

/** NIP-66 relay 發現事件的 kind。 */
export const RELAY_DISCOVERY_KIND = 30166;

/** 解析所需的最小事件形狀（不依賴 core 的完整 NostrEvent）。 */
export interface DiscoveryEvent {
  kind: number;
  pubkey: string;
  tags: string[][];
  created_at: number;
}

export interface Candidate {
  /** 正規化後的 relay URL。 */
  url: string;
  /** 有多少位**不同的**監測者回報了它（NIP-66：不要只信一個來源）。 */
  monitors: number;
  /** 回報中最低的 open RTT（毫秒）；無人回報則 undefined。 */
  rttMs?: number;
}

export interface DiscoverOptions {
  /** 至少要幾位監測者同時回報才列為候選；預設 2。 */
  minMonitors?: number;
  /** 已知的 relay（正規化前後皆可）——已在清單裡的不再列為候選。 */
  known?: Iterable<string>;
}

/** 取某個 tag 的第一個值。 */
function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

/** 取某個 tag 的所有值。 */
function tagValues(tags: string[][], name: string): string[] {
  return tags.filter((t) => t[0] === name && t[1] !== undefined).map((t) => t[1]!);
}

/**
 * 正規化 relay URL，讓「同一座站」在比對時收斂成同一個字串。
 *
 * 只做**無爭議**的正規化：協定與主機小寫、去掉尾斜線、去掉預設埠。
 * 刻意不碰路徑——`/s/<prefix>` 這種分片路徑（ADR-0241）是有意義的，砍掉就指到別處了。
 *
 * 非 `ws:`／`wss:` 一律回 undefined：30166 的 `d` 是監測者填的，不保證是 relay URL。
 */
export function normalizeRelayUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return undefined;
  if (!url.hostname) return undefined;
  const port =
    (url.protocol === "wss:" && url.port === "443") || (url.protocol === "ws:" && url.port === "80")
      ? ""
      : url.port;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.hostname.toLowerCase()}${port ? `:${port}` : ""}${path}`;
}

/**
 * 這顆 30166 是否描述一座**免費的、clearnet 上的**站。
 *
 * - `["R","!payment"]`：`!` 前綴＝不支援 ⇒ 不收費。**沒有這個 tag 就不算**——
 *   「沒說要收費」與「說了不收費」是兩件事，而我們要的是後者。
 * - `["n","clearnet"]`：tor／i2p／loki 的可達性取決於使用者環境，不該進通用候選池。
 *
 * ⚠ **刻意不過濾 `["R","auth"]`**：本專案自己的中繼就要求 NIP-42（ADR-0057），
 * 把「要求認證」當成扣分等於排除掉行為與我們最像的那些站。
 */
export function isFreeClearnetRelay(event: DiscoveryEvent): boolean {
  const requirements = tagValues(event.tags, "R");
  if (!requirements.includes("!payment")) return false;
  const networks = tagValues(event.tags, "n");
  // 沒報 `n` 的視為 clearnet（NIP-66 的預設網路）。
  return networks.length === 0 || networks.includes("clearnet");
}

/** 取 open RTT（毫秒）；缺或非數字回 undefined。 */
function rttOf(event: DiscoveryEvent): number | undefined {
  const raw = tagValue(event.tags, "rtt-open");
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * 從一批 30166 事件整理出候選 relay（ADR-0366 P2 #12）。
 *
 * 🔴 **同一位監測者重複回報同一座站只算一次**——否則一個監測者自己發 N 顆就能
 * 偽造「多來源同意」，而多來源正是 NIP-66 建議的那道防線。
 */
export function discoverCandidates(
  events: readonly DiscoveryEvent[],
  opts: DiscoverOptions = {},
): Candidate[] {
  const minMonitors = opts.minMonitors ?? 2;
  const known = new Set<string>();
  for (const k of opts.known ?? []) {
    const n = normalizeRelayUrl(k);
    if (n) known.add(n);
  }

  /** url → (監測者 pubkey → 該監測者回報的最低 RTT) */
  const seen = new Map<string, Map<string, number | undefined>>();
  for (const event of events) {
    if (event.kind !== RELAY_DISCOVERY_KIND) continue;
    if (!isFreeClearnetRelay(event)) continue;
    const d = tagValue(event.tags, "d");
    const url = d === undefined ? undefined : normalizeRelayUrl(d);
    if (!url || known.has(url)) continue;

    const byMonitor = seen.get(url) ?? new Map<string, number | undefined>();
    const rtt = rttOf(event);
    const prev = byMonitor.get(event.pubkey);
    byMonitor.set(
      event.pubkey,
      prev === undefined ? rtt : rtt === undefined ? prev : Math.min(prev, rtt),
    );
    seen.set(url, byMonitor);
  }

  const out: Candidate[] = [];
  for (const [url, byMonitor] of seen) {
    if (byMonitor.size < minMonitors) continue;
    const rtts = [...byMonitor.values()].filter((v): v is number => v !== undefined);
    out.push({ url, monitors: byMonitor.size, ...(rtts.length > 0 ? { rttMs: Math.min(...rtts) } : {}) });
  }
  // 先依監測者數（信心）再依 URL 字典序——**不依 RTT**：RTT 是本地量測值，
  // 拿它排序會讓不同地點的人得到不同順序，而這份清單是要給人比對的。
  out.sort((a, b) => b.monitors - a.monitors || a.url.localeCompare(b.url));
  return out;
}
