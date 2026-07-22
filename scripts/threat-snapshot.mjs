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
