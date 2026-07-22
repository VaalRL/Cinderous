// 威脅情報 snapshot 產生器（ADR-0231 P2）：抓開源清單（URLhaus CC0＋StevenBlack MIT）、
// 抽 registrable domain、分來源寫入 docs/threat-intel.json（官網 build 複製進 dist 供 app 拉取）。
// 用法：node scripts/threat-snapshot.mjs        —— 抓取並更新 snapshot（CI 排程）
//       node scripts/threat-snapshot.mjs --check —— 僅驗證現有 snapshot 格式（離線、供 CI PR 檢查）
// 來源失敗時保留上一版該來源的網域（韌性：單一來源掛掉不清空資料）。

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../docs/threat-intel.json", import.meta.url);

/** 每來源網域上限（體積控制，ADR-0231）：超過即截斷並記錄 dropped（不靜默）。 */
const MAX_PER_SOURCE = 20000;

/** 來源定義：feeds 依序嘗試（後者為 GitHub raw 鏡像——abuse.ch 偶有網路不可達）。 */
const SOURCES = [
  {
    id: "urlhaus",
    name: "URLhaus",
    url: "https://urlhaus.abuse.ch",
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
function isNeverBlocked(domain) {
  if (NEVER_BLOCK_EXACT.has(domain)) return true;
  return NEVER_BLOCK_SUFFIX.some((h) => domain === h || domain.endsWith(`.${h}`));
}

/**
 * 單次更新允許的最大變動比例（ADR-0235 H5）。上游被投毒或格式改版時，網域數通常會
 * 劇烈跳動——超過此比例即中止並保留上一版，讓人先看一眼再決定。首次建立（無前版）不套用。
 */
const MAX_CHANGE_RATIO = 0.5;

/** 解析 hosts 格式（`127.0.0.1 domain`／`0.0.0.0 domain`）→ 正規化網域集合。 */
function parseHosts(text) {
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

async function fetchFeed(feeds) {
  for (const feed of feeds) {
    try {
      const res = await fetch(feed, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        console.warn(`  ⚠ ${feed} → HTTP ${res.status}`);
        continue;
      }
      return { feed, text: await res.text() };
    } catch (err) {
      console.warn(`  ⚠ ${feed} → ${err?.message ?? err}`);
    }
  }
  return null;
}

function loadPrevious() {
  if (!existsSync(OUT)) return null;
  try {
    return JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    return null;
  }
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
  console.log(`✓ snapshot 格式正確（updated: ${snap.updated ?? "?"}）`);
}

async function main() {
  if (process.argv.includes("--check")) return check();

  const prev = loadPrevious();
  const domains = {};
  const dropped = {};
  for (const src of SOURCES) {
    console.log(`抓取 ${src.name}…`);
    const got = await fetchFeed(src.feeds);
    if (!got) {
      const kept = prev?.domains?.[src.id] ?? [];
      console.warn(`  ✗ ${src.name} 全部 feed 失敗——保留上一版 ${kept.length} 筆`);
      domains[src.id] = kept;
      continue;
    }
    const parsed = [...parseHosts(got.text)].sort();
    if (parsed.length > MAX_PER_SOURCE) {
      dropped[src.id] = parsed.length - MAX_PER_SOURCE;
      console.warn(`  ⚠ ${src.name} ${parsed.length} 筆 → 截斷至 ${MAX_PER_SOURCE}（dropped ${dropped[src.id]}）`);
    }
    domains[src.id] = parsed.slice(0, MAX_PER_SOURCE);
    console.log(`  ✓ ${src.name}: ${domains[src.id].length} 網域（${got.feed}）`);

    // 變動量護欄（ADR-0235 H5）：上游被投毒或格式改版時網域數會劇烈跳動。超過門檻就
    // **保留上一版**並讓 workflow 失敗——寧可情報舊一天，也不要靜默地把半個網際網路遮起來。
    const before = prev?.domains?.[src.id];
    if (Array.isArray(before) && before.length > 0) {
      const delta = Math.abs(domains[src.id].length - before.length) / before.length;
      if (delta > MAX_CHANGE_RATIO) {
        console.error(
          `✗ ${src.name} 網域數變動 ${(delta * 100).toFixed(0)}%（${before.length} → ${domains[src.id].length}），` +
            `超過 ${MAX_CHANGE_RATIO * 100}% 門檻。保留上一版，請人工確認上游是否異常。`,
        );
        process.exit(1);
      }
    }
  }

  const snapshot = {
    updated: new Date().toISOString().slice(0, 10),
    ...(Object.keys(dropped).length > 0 ? { dropped } : {}),
    sources: SOURCES.map(({ id, name, url }) => ({ id, name, url })),
    domains,
  };
  writeFileSync(OUT, JSON.stringify(snapshot));
  const total = Object.values(domains).reduce((n, l) => n + l.length, 0);
  console.log(`✓ 寫入 docs/threat-intel.json（${total} 網域）`);
}

await main();
