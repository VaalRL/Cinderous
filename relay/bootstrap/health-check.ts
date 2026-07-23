// 引導 relay 清單健康檢查 + 簽章發佈（ADR-0039）。
//
// GitHub Actions 每小時執行：以 REQ→EOSE 往返探測每座 relay（順帶驗證對端確為
// relay），剔除逾時者；never-empty 守門（全滅則保留原清單、不覆寫）；若提供
// 維護者金鑰（MAINTAINER_NSEC）則產生簽章的 kind RELAY_LIST 事件供發佈。
//
// 執行：pnpm --filter @cinderous/relay bootstrap:run
// 信任根＝維護者金鑰；此腳本與 GitHub 僅為發佈通道，無法偽造簽章清單。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateAdmission, generateSecretKey, listEntries, nsecDecode, signRelayList, type RelayEntry, type RelayListDoc } from "@cinderous/core";
import { autoAuth, parse, runConformance, withWs } from "./conformance.js";

// 打包後執行檔位於 relay/dist/；清單常駐 relay/bootstrap/。
const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_DIR = join(HERE, "..", "bootstrap");
const LIST_PATH = join(BOOTSTRAP_DIR, "relays.json");
const EVENT_PATH = join(BOOTSTRAP_DIR, "relay-list-event.json");
const HISTORY_PATH = join(BOOTSTRAP_DIR, "health-history.json");
const UPTIME_MIN_SAMPLES = 12; // 少於此探測次數＝uptime 資料不足（維持試用）
const UPTIME_CAP = 720; // 滾動窗上限（≈30 天/時）；到頂折半保留比例

/** 每座 relay 的滾動 uptime 計數（維護者工具狀態；非伺服器狀態）。 */
interface UptimeRec {
  probes: number;
  live: number;
}
function readHistory(): Record<string, UptimeRec> {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf8")) as Record<string, UptimeRec>;
  } catch {
    return {};
  }
}
function writeHistory(h: Record<string, UptimeRec>): void {
  writeFileSync(HISTORY_PATH, `${JSON.stringify(h, null, 2)}\n`);
}

/**
 * 發佈一個事件到 relay：**先做 NIP-42 AUTH**，再送 `["EVENT", …]`，等 OK 或逾時。
 *
 * 🔴 requireAuth 中繼的 EVENT 也要先認證（relay-core.ts：未認證回 `["OK", id, false, "auth-required…"]`）。
 * 過去這支直接送 EVENT → 被回 OK false → 帶內發佈永遠失敗。改用與探測同一套 `withWs`+`autoAuth`：
 * 臨時金鑰認證即可（公共站不限制事件作者，AUTH 只證明握有某把鑰）。不要求認證的中繼照走（500ms 後直送）。
 */
function publishEvent(url: string, event: unknown): Promise<boolean> {
  const id = (event as { id?: string }).id;
  const sk = generateSecretKey();
  return withWs(url, false, (ws, done) => {
    const onAuth = autoAuth(ws, url, sk);
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      ws.send(JSON.stringify(["EVENT", event]));
    };
    ws.addEventListener("open", () => setTimeout(send, 500)); // 不要求認證的中繼：直接送
    ws.addEventListener("message", (e) => {
      const m = parse(e.data);
      if (!m) return;
      onAuth(m); // requireAuth 中繼：先回應 AUTH 挑戰
      if (m[0] === "OK" && m[1] !== id && !sent) send(); // AUTH 成功 → 立刻發佈（不等 500ms）
      if (m[0] === "OK" && m[1] === id) done(Boolean(m[2])); // 我們事件的發佈結果
    });
  });
}

async function main(): Promise<void> {
  const current = JSON.parse(readFileSync(LIST_PATH, "utf8")) as RelayListDoc;

  // 離線簽發（ADR-0239）：維護者本機以 `--sign-only` 對**已提交的明文清單**簽章＋帶內發佈，
  // 不探測、不改 health-history。信任根金鑰因此不需進 CI——CI 只探測＋更新明文清單。
  if (process.argv.includes("--sign-only")) {
    const nsec = process.env.MAINTAINER_NSEC?.trim();
    if (!nsec) throw new Error("--sign-only 需要 MAINTAINER_NSEC（維護者本機離線簽發）");
    await signAndPublish(current, nsec);
    return;
  }

  // ADR-0069/0092：一致性探測（含 liveness）自動維護 accepting/weight；retired 免探測原樣保留。
  const entries = listEntries(current);
  const active = entries.filter((e) => e.status !== "retired");
  const history = readHistory();
  console.log(`一致性探測 ${active.length} 座 relay…（retired ${entries.length - active.length} 座跳過）`);

  const results = await Promise.all(
    active.map(async (e) => {
      const h = history[e.url] ?? { probes: 0, live: 0 };
      const uptimePct = h.probes >= UPTIME_MIN_SAMPLES ? (h.live / h.probes) * 100 : undefined;
      const conf = await runConformance(e.url, uptimePct);
      let probes = h.probes + 1;
      let live = h.live + (conf.live ? 1 : 0);
      if (probes > UPTIME_CAP) {
        probes = Math.round(probes / 2);
        live = Math.round(live / 2);
      }
      history[e.url] = { probes, live };
      return { e, conf };
    }),
  );
  writeHistory(history);
  for (const { e, conf } of results) {
    const mark = !conf.live ? "❌" : conf.ephemeral && conf.rejectsExpired ? "✅" : "⚠一致性";
    console.log(`  ${mark} ${e.url}${e.status !== "ok" ? `（${e.status}）` : ""}`);
  }

  const liveOnes = results.filter((r) => r.conf.live);
  // never-empty 守門：全滅則保留原清單、不覆寫（避免把全體客戶端變孤島）。
  if (liveOnes.length === 0) {
    console.warn("⚠ 無任何存活 relay：保留原清單、不更新。");
    return;
  }

  // 分級收錄（ADR-0092）：機器依 evaluateAdmission 定 accepting/weight（status:ok）；
  // draining 手動退役中保留、retired 原樣。人管「加入/退役＋簽章」，機器管品質。
  const decided = liveOnes.map(({ e, conf }) => {
    if (e.status === "draining") return e;
    const d = evaluateAdmission(conf);
    console.log(`    ↳ ${e.url}: ${d.reasons.join("；")}`);
    return { ...e, accepting: d.accepting, weight: d.weight, status: "ok" as const };
  });

  // entries＝健康座（保留營運欄位）＋ retired 座；relays（舊欄位）＝健康且未退役的 URL。
  const compact = (e: (typeof entries)[number]): RelayEntry => ({
    url: e.url,
    ...(e.accepting ? {} : { accepting: false }),
    ...(e.weight !== 1 ? { weight: e.weight } : {}),
    ...(e.status !== "ok" ? { status: e.status } : {}),
  });
  const nextEntries = [...decided, ...entries.filter((e) => e.status === "retired")].map(compact);
  const relays = decided.map((e) => e.url);
  const changed =
    JSON.stringify({ r: relays, e: nextEntries }) !==
    JSON.stringify({ r: current.relays, e: current.entries ?? null });
  const next: RelayListDoc = changed
    ? { relays, entries: nextEntries, updatedAt: Math.floor(Date.now() / 1000) }
    : current;

  if (changed) {
    writeFileSync(LIST_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`更新清單：${relays.length} 座健康、${nextEntries.length - relays.length} 座已退役。`);
  } else {
    console.log("清單無變化。");
  }

  // 簽章發佈：本機提供 MAINTAINER_NSEC 才簽。**CI 常態不提供**——信任根金鑰不進 CI，
  // 改由維護者本機離線簽發（ADR-0239）。維護者若在本機跑完整探測，這條會順手簽＋發佈。
  const nsec = process.env.MAINTAINER_NSEC?.trim();
  if (nsec) {
    await signAndPublish(next, nsec);
  } else {
    console.log("未提供 MAINTAINER_NSEC：僅更新明文清單（CI 常態；簽章由維護者離線執行，ADR-0239）。");
  }
}

/**
 * 以維護者金鑰簽章 relay 清單並帶內發佈到清單內每座 relay（ADR-0039）。
 * 供正常探測後的順手簽發，以及 `--sign-only`（對已提交清單離線補簽）共用。
 */
async function signAndPublish(doc: RelayListDoc, nsec: string): Promise<void> {
  const event = signRelayList(doc, nsecDecode(nsec));
  writeFileSync(EVENT_PATH, `${JSON.stringify(event, null, 2)}\n`);
  console.log(`已簽章 relay 清單事件（kind ${event.kind}）→ ${EVENT_PATH}`);
  // 帶內發佈：把簽章清單推到每座 relay，客戶端連上即學到（以 npub…@relay hint 驗釘死維護者公鑰）。
  const pubResults = await Promise.all(doc.relays.map(async (u) => [u, await publishEvent(u, event)] as const));
  for (const [u, ok] of pubResults) console.log(`  ${ok ? "📡" : "⚠"} 發佈至 ${u}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
