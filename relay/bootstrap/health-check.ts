// 引導 relay 清單健康檢查 + 簽章發佈（ADR-0039）。
//
// GitHub Actions 每小時執行：以 REQ→EOSE 往返探測每座 relay（順帶驗證對端確為
// relay），剔除逾時者；never-empty 守門（全滅則保留原清單、不覆寫）；若提供
// 維護者金鑰（MAINTAINER_NSEC）則產生簽章的 kind RELAY_LIST 事件供發佈。
//
// 執行：pnpm --filter @nostr-buddy/relay bootstrap:run
// 信任根＝維護者金鑰；此腳本與 GitHub 僅為發佈通道，無法偽造簽章清單。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { nsecDecode, signRelayList, type RelayListDoc } from "@nostr-buddy/core";

// 打包後執行檔位於 relay/dist/；清單常駐 relay/bootstrap/。
const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_DIR = join(HERE, "..", "bootstrap");
const LIST_PATH = join(BOOTSTRAP_DIR, "relays.json");
const EVENT_PATH = join(BOOTSTRAP_DIR, "relay-list-event.json");
const PROBE_TIMEOUT_MS = 8000;

/** REQ→EOSE 往返探測一座 relay；成功回傳 true。 */
async function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.addEventListener("open", () => {
      // 空結果的最小訂閱：健康 relay 應立即回 EOSE。
      ws.send(JSON.stringify(["REQ", "health", { kinds: [1], limit: 0 }]));
    });
    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(typeof e.data === "string" ? e.data : "");
        if (Array.isArray(msg) && msg[0] === "EOSE" && msg[1] === "health") {
          clearTimeout(timer);
          finish(true);
        }
      } catch {
        /* 忽略非 JSON */
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/** 發佈一個事件到 relay：送 `["EVENT", …]`，等 OK 或逾時。 */
async function publishEvent(url: string, event: unknown): Promise<boolean> {
  const id = (event as { id?: string }).id;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.addEventListener("open", () => ws.send(JSON.stringify(["EVENT", event])));
    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(typeof e.data === "string" ? e.data : "");
        if (Array.isArray(msg) && msg[0] === "OK" && msg[1] === id) {
          clearTimeout(timer);
          finish(Boolean(msg[2]));
        }
      } catch {
        /* 忽略 */
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

async function main(): Promise<void> {
  const current = JSON.parse(readFileSync(LIST_PATH, "utf8")) as RelayListDoc;
  const candidates = [...new Set(current.relays)];
  console.log(`探測 ${candidates.length} 座 relay…`);

  const results = await Promise.all(candidates.map(async (url) => [url, await probe(url)] as const));
  const healthy = results.filter(([, ok]) => ok).map(([url]) => url);
  for (const [url, ok] of results) console.log(`  ${ok ? "✅" : "❌"} ${url}`);

  // never-empty 守門：全滅則保留原清單、不覆寫（避免把全體客戶端變孤島）。
  if (healthy.length === 0) {
    console.warn("⚠ 無任何健康 relay：保留原清單、不更新。");
    return;
  }

  const changed = JSON.stringify(healthy) !== JSON.stringify(current.relays);
  const next: RelayListDoc = changed
    ? { relays: healthy, updatedAt: Math.floor(Date.now() / 1000) }
    : current;

  if (changed) {
    writeFileSync(LIST_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`更新清單：${healthy.length} 座健康。`);
  } else {
    console.log("清單無變化。");
  }

  // 簽章發佈（可選）：有維護者金鑰才簽。
  const nsec = process.env.MAINTAINER_NSEC?.trim();
  if (nsec) {
    const event = signRelayList(next, nsecDecode(nsec));
    writeFileSync(EVENT_PATH, `${JSON.stringify(event, null, 2)}\n`);
    console.log(`已簽章 relay 清單事件（kind ${event.kind}）→ ${EVENT_PATH}`);
    // 帶內發佈（ADR-0039）：把簽章清單推到每座健康 relay，客戶端連上即學到。
    const pubResults = await Promise.all(healthy.map(async (u) => [u, await publishEvent(u, event)] as const));
    for (const [u, ok] of pubResults) console.log(`  ${ok ? "📡" : "⚠"} 發佈至 ${u}`);
  } else {
    console.log("未提供 MAINTAINER_NSEC：略過簽章與發佈（僅更新明文清單）。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
