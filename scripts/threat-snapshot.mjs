// 威脅情報 snapshot 產生器（ADR-0231 P2；多-feed 聯集模型 ADR-0248）：抓開源清單
// （URLhaus CC0＋StevenBlack MIT）、抽 registrable domain、分來源寫入 docs/threat-intel.json
// （官網 build 複製進 dist 供 app 拉取）。
//
// 用法：node scripts/threat-snapshot.mjs          —— 抓取並更新 snapshot（CI 排程）
//       node scripts/threat-snapshot.mjs --check  —— 僅驗證現有 snapshot／快取格式（離線，供 CI PR 檢查）
//       node scripts/threat-snapshot.mjs --reseed —— 重建並跳過變動量護欄（來源組成刻意變動時重設基準）
//
// 多-feed 來源（如 URLhaus）採「聯集」：把該來源所有 feed 抓下來去重合併，而非「誰先通用誰」。
// 為讓聯集跨環境穩定（abuse.ch 偶有網路不可達，本機/CI 抓到的 feed 不同），每個 feed 最後成功的
// 內容記在 docs/threat-intel.feeds.json（逐-feed last-known-good；committed，不在 vite 白名單＝不送 app）：
// 某 feed 這次抓失敗就沿用它的記憶，聯集不縮水 → 護欄只在「真的大量增減」時才響（ADR-0248）。
// 來源全 feed 皆失敗且無記憶時，保留上一版該來源（韌性：單一來源掛掉不清空資料）。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUT = new URL("../docs/threat-intel.json", import.meta.url);
/** 逐-feed last-known-good 快取（僅多-feed 來源需要；committed、不在 apps/website vite 白名單＝不送 app）。 */
const FEED_CACHE = new URL("../docs/threat-intel.feeds.json", import.meta.url);

/** 每來源網域上限（體積控制，ADR-0231）：超過即截斷並記錄 dropped（不靜默）。 */
const MAX_PER_SOURCE = 20000;

/** 來源定義：多 feed 者取聯集（feeds 全部都抓，順序不影響結果）。 */
const SOURCES = [
  {
    id: "urlhaus",
    name: "URLhaus",
    url: "https://urlhaus.abuse.ch",
    // 兩個 feed 取聯集（ADR-0248）：abuse.ch 直連＝即時活躍威脅（覆蓋新、偶有不可達）；
    // StevenBlack 的 URLHaus 鏡像＝穩定可達但較滯後。合併後覆蓋最廣；逐-feed 記憶讓某座暫時
    // 掛掉時聯集不縮水（先前「換源」造成的護欄誤觸就此消除）。
    feeds: [
      "https://urlhaus.abuse.ch/downloads/hostfile/",
      "https://raw.githubusercontent.com/StevenBlack/hosts/master/data/URLHaus/hosts",
    ],
  },
  {
    id: "stevenblack",
    name: "StevenBlack hosts",
    url: "https://github.com/StevenBlack/hosts",
    feeds: ["https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"],
  },
];

/** 合法網域（至少兩段、每段英數/連字號/底線；長度上限 253）。 */
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

/** hosts 檔本身的佔位條目，不是威脅網域。 */
const HOSTS_NOISE = new Set(["localhost", "localhost.localdomain", "local", "broadcasthost", "ip6-localhost", "ip6-loopback"]);

// ── 絕不封鎖清單（ADR-0235 H5）────────────────────────────────────────────────
//
// 這份 snapshot 是**第三方餵進來的**——URLhaus 與 StevenBlack 被投毒、或單純誤報，都會讓
// 全體使用者的連結被遮罩；嚴格模式下更會**阻止送出**。那實質上是一條經由上游的審查／DoS
// 通道，而 `--check` 修正前**只驗格式、不驗內容**。
//
// 清單刻意分兩種比對，因為兩者的風險完全不同：

/**
 * **精確比對**：這些 apex 網域本身不得被封鎖，但**子網域可以**。
 *
 * `ads.google.com`／`ads.mozilla.org` 被封鎖是完全正確的——那正是 StevenBlack 的用途。
 * 會出事的是有人（或某次上游格式改版）把 `google.com` 本身塞進清單。
 */
const NEVER_BLOCK_EXACT = new Set([
  "github.com",
  "githubusercontent.com",
  "githubassets.com",
  "cloudflare.com",
  "gnu.org",
  "abuse.ch",
  "google.com",
  "wikipedia.org",
  "mozilla.org",
  "apple.com",
  "microsoft.com",
]);

/**
 * **後綴比對**（含子網域）：Cinderous 自己的基礎設施。
 *
 * 刻意只列**我們自己的完整主機**，不整片保護 `workers.dev`／`github.io`
 * ——那兩個共享網域上也住著真正的釣魚站，整片放行等於在情報上開一個洞。
 * 但若上游封鎖了我們自己的中繼或官網，app 會把自己的連結遮起來（自我 DoS）。
 */
const NEVER_BLOCK_SUFFIX = [
  "cinder-relay.cinderous1.workers.dev",
  "cinder-relay.jt0856.workers.dev",
  "cinderous.cinderous1.workers.dev",
  "vaalrl.github.io",
];

/** 該網域是否受絕不封鎖保護（apex 精確比對；自家基礎設施含子網域）。 */
export function isNeverBlocked(domain) {
  if (NEVER_BLOCK_EXACT.has(domain)) return true;
  return NEVER_BLOCK_SUFFIX.some((h) => domain === h || domain.endsWith(`.${h}`));
}

/**
 * 單次更新允許的最大變動比例（ADR-0235 H5）。上游被投毒或格式改版時，網域數通常會
 * 劇烈跳動——超過此比例即中止並保留上一版，讓人先看一眼再決定。首次建立（無前版）不套用。
 */
const MAX_CHANGE_RATIO = 0.5;

/** 解析 hosts 格式（`127.0.0.1 domain`／`0.0.0.0 domain`）→ 正規化網域集合。 */
export function parseHosts(text) {
  const out = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = line.match(/^(?:127\.0\.0\.1|0\.0\.0\.0)\s+(\S+)/);
    if (!m) continue;
    const domain = m[1].toLowerCase().replace(/^www\./, "");
    if (HOSTS_NOISE.has(domain) || domain === "0.0.0.0") continue;
    if (isNeverBlocked(domain)) continue; // ADR-0235 H5：上游說什麼都不封鎖這些
    if (DOMAIN_RE.test(domain)) out.add(domain);
  }
  return out;
}

/**
 * **純函式**：把一個來源的各 feed 結果合併成聯集，並算出要寫回的逐-feed 記憶。
 *
 * @param feeds     來源宣告的 feed 網址順序
 * @param freshByFeed  本次抓取結果 `{ feedUrl: string[] | null }`（null＝抓失敗）
 * @param cache     上次的逐-feed 記憶 `{ feedUrl: string[] }`
 * @returns `{ domains, feedMemory }`：
 *          - `domains`：去重排序後的聯集；**全 feed 皆失敗且完全無記憶時為 null**（呼叫端保留上一版）。
 *          - `feedMemory`：本次要寫回快取的逐-feed 內容（新鮮者用新的、失敗者沿用記憶）。
 */
export function unionWithMemory(feeds, freshByFeed, cache = {}) {
  const feedMemory = {};
  const union = new Set();
  let anyFresh = false;
  for (const feed of feeds) {
    const fresh = freshByFeed[feed];
    const feedDomains = fresh ?? cache[feed] ?? [];
    if (fresh) anyFresh = true;
    feedMemory[feed] = feedDomains;
    for (const d of feedDomains) union.add(d);
  }
  if (!anyFresh && union.size === 0) return { domains: null, feedMemory };
  return { domains: [...union].sort(), feedMemory };
}

/** **純函式**：變動量是否超過門檻（首次建立或空前版＝不觸發）。 */
export function guardTripped(newLen, prevLen, ratio = MAX_CHANGE_RATIO) {
  if (!Number.isFinite(prevLen) || prevLen <= 0) return false;
  return Math.abs(newLen - prevLen) / prevLen > ratio;
}

/** 抓取單一 feed；成功回傳解析後的網域陣列，失敗回傳 null（呼叫端決定沿用記憶）。 */
async function fetchFeed(feed) {
  try {
    const res = await fetch(feed, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`  ⚠ ${feed} → HTTP ${res.status}`);
      return null;
    }
    return [...parseHosts(await res.text())];
  } catch (err) {
    console.warn(`  ⚠ ${feed} → ${err?.message ?? err}`);
    return null;
  }
}

/** 抓取一個來源的所有 feed，交給 `unionWithMemory` 合併（I/O 與純邏輯分離）。 */
async function resolveSource(src, cache) {
  const freshByFeed = {};
  for (const feed of src.feeds) {
    const fresh = await fetchFeed(feed);
    freshByFeed[feed] = fresh;
    if (fresh) console.log(`  ✓ ${feed}: ${fresh.length}`);
    else console.warn(`  ↩ ${feed} 失敗——沿用記憶 ${(cache[feed] ?? []).length} 筆`);
  }
  return unionWithMemory(src.feeds, freshByFeed, cache);
}

function loadPrevious() {
  if (!existsSync(OUT)) return null;
  try {
    return JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    return null;
  }
}

/** 載入逐-feed 記憶（缺檔或壞檔＝視為空記憶，首次建立會自然填上）。 */
function loadFeedCache() {
  if (!existsSync(FEED_CACHE)) return {};
  try {
    return JSON.parse(readFileSync(FEED_CACHE, "utf8"))?.feeds ?? {};
  } catch {
    return {};
  }
}

/** 驗證逐-feed 記憶（存在才驗）：格式合法且**不含絕不封鎖網域**（供應鏈真正風險，ADR-0235 H5）。 */
function checkCache() {
  if (!existsSync(FEED_CACHE)) return; // 選用檔（無多-feed 來源或首次建立前）
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(FEED_CACHE, "utf8"));
  } catch {
    console.error("✗ docs/threat-intel.feeds.json 非 JSON");
    process.exit(1);
  }
  const feeds = parsed?.feeds;
  if (typeof feeds !== "object" || feeds === null) {
    console.error("✗ feeds 快取形狀不符（feeds{}）");
    process.exit(1);
  }
  for (const [feed, list] of Object.entries(feeds)) {
    if (!Array.isArray(list)) {
      console.error(`✗ feed 快取 ${feed} 非陣列`);
      process.exit(1);
    }
    const bad = list.filter((d) => typeof d !== "string" || !DOMAIN_RE.test(d));
    if (bad.length > 0) {
      console.error(`✗ feed 快取 ${feed} 有 ${bad.length} 筆非法網域（如 ${JSON.stringify(bad[0])}）`);
      process.exit(1);
    }
    const forbidden = list.filter((d) => isNeverBlocked(d));
    if (forbidden.length > 0) {
      console.error(`✗ feed 快取 ${feed} 含絕不封鎖網域：${forbidden.slice(0, 5).join(", ")}`);
      process.exit(1);
    }
  }
  console.log(`✓ feeds 快取格式正確（${Object.keys(feeds).length} feed）`);
}

function check() {
  const snap = loadPrevious();
  if (!snap) {
    console.error("✗ docs/threat-intel.json 缺失或非 JSON");
    process.exit(1);
  }
  if (!Array.isArray(snap.sources) || snap.sources.length === 0 || typeof snap.domains !== "object") {
    console.error("✗ snapshot 形狀不符（sources[] / domains{}）");
    process.exit(1);
  }
  for (const src of snap.sources) {
    const list = snap.domains[src.id];
    if (!Array.isArray(list)) {
      console.error(`✗ 來源 ${src.id} 缺 domains 陣列`);
      process.exit(1);
    }
    const bad = list.filter((d) => typeof d !== "string" || !DOMAIN_RE.test(d));
    if (bad.length > 0) {
      console.error(`✗ 來源 ${src.id} 有 ${bad.length} 筆非法網域（如 ${JSON.stringify(bad[0])}）`);
      process.exit(1);
    }
    // ADR-0235 H5：格式合法但**內容有毒**是這條供應鏈的真正風險——修正前完全沒檢查。
    const forbidden = list.filter((d) => isNeverBlocked(d));
    if (forbidden.length > 0) {
      console.error(`✗ 來源 ${src.id} 含絕不封鎖網域：${forbidden.slice(0, 5).join(", ")}`);
      process.exit(1);
    }
    console.log(`✓ ${src.id}: ${list.length} 網域`);
  }
  checkCache();
  console.log(`✓ snapshot 格式正確（updated: ${snap.updated ?? "?"}）`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--check")) return check();
  const reseed = argv.includes("--reseed");

  const prev = loadPrevious();
  const feedCache = loadFeedCache();
  const domains = {};
  const dropped = {};
  const newFeedCache = {};

  for (const src of SOURCES) {
    console.log(`抓取 ${src.name}…`);
    const { domains: resolved, feedMemory } = await resolveSource(src, feedCache);
    if (src.feeds.length > 1) Object.assign(newFeedCache, feedMemory); // 僅多-feed 來源進快取

    if (resolved === null) {
      const kept = prev?.domains?.[src.id] ?? [];
      console.warn(`  ✗ ${src.name} 無新資料——保留上一版 ${kept.length} 筆`);
      domains[src.id] = kept;
      continue;
    }

    if (resolved.length > MAX_PER_SOURCE) {
      dropped[src.id] = resolved.length - MAX_PER_SOURCE;
      console.warn(`  ⚠ ${src.name} ${resolved.length} 筆 → 截斷至 ${MAX_PER_SOURCE}（dropped ${dropped[src.id]}）`);
    }
    domains[src.id] = resolved.slice(0, MAX_PER_SOURCE);
    console.log(`  ✓ ${src.name}（聯集）: ${domains[src.id].length} 網域`);

    // 變動量護欄（ADR-0235 H5）：以穩定聯集比對上一版，超過門檻就保留上一版並讓 workflow 失敗。
    // --reseed 時跳過（首次建聯集／刻意加減 feed 屬預期跳動，人工重設基準；ADR-0248）。
    const before = prev?.domains?.[src.id];
    if (!reseed && guardTripped(domains[src.id].length, before?.length)) {
      console.error(
        `✗ ${src.name} 網域數變動 ${((Math.abs(domains[src.id].length - before.length) / before.length) * 100).toFixed(0)}%` +
          `（${before.length} → ${domains[src.id].length}），超過 ${MAX_CHANGE_RATIO * 100}% 門檻。` +
          `保留上一版，請人工確認上游（或以 --reseed 重設基準）。`,
      );
      process.exit(1);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const snapshot = {
    updated: today,
    ...(Object.keys(dropped).length > 0 ? { dropped } : {}),
    sources: SOURCES.map(({ id, name, url }) => ({ id, name, url })),
    domains,
  };
  writeFileSync(OUT, JSON.stringify(snapshot));

  // 逐-feed 記憶（僅多-feed 來源）：committed 供跨環境沿用；不在 vite 白名單＝不送 app。
  if (Object.keys(newFeedCache).length > 0) {
    const cache = {
      _note:
        "產生器內部快取：多-feed 來源的逐-feed last-known-good，供聯集在某 feed 暫時不可達時不縮水。" +
        "非 app 用（不在 apps/website vite 白名單）。見 ADR-0248。",
      updated: today,
      feeds: newFeedCache,
    };
    writeFileSync(FEED_CACHE, JSON.stringify(cache));
  }

  const total = Object.values(domains).reduce((n, l) => n + l.length, 0);
  console.log(`✓ 寫入 docs/threat-intel.json（${total} 網域）${reseed ? "（--reseed：已跳過護欄）" : ""}`);
}

// 作為腳本執行才跑 main（供測試 import 純函式而不觸發抓取／寫檔）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
