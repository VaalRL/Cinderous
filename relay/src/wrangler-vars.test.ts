// `wrangler.toml` 的兩份 vars 必須一致（ADR-0354）。
//
// ## 為什麼需要這支測試
//
// wrangler 的具名環境**不繼承**頂層設定，所以 `[vars]` 與 `[env.unified.vars]` 是兩份要手動
// 同步的宣告。漏掉哪一個，統一模式部署出來的站就少哪一個——贊助欄位（ADR-0089）會整個
// 消失、TURN（ADR-0243）會退回純 STUN——而 **wrangler 不會警告**。
//
// 那種漂移的症狀是「部署成功但行為不對」，比部署失敗難查得多。ADR-0354 的後果節已經把它
// 列為已知風險；這支測試把「已知風險」變成「會變紅的東西」。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STORAGE_BUDGET_BYTES,
  computeCeilingBudget,
  doCapacityFor,
  doCapacitySettings,
  doCeilingFor,
  doCeilings,
  fileLaneChunksPerRecipient,
  fileLanes,
  MIB,
  worstCaseStorage,
} from "./host-config.js";
import { FILE_EVENT_MAX_BYTES } from "./message-store.js";
import { namedLaneName } from "./shard.js";

const TOML = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

/** 讀出某個 section 底下的 `key = "value"`（只認這份檔案用得到的那種簡單形式）。 */
function varsOf(section: string): Record<string, string> {
  const lines = TOML.split("\n");
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) return {};
  const out: Record<string, string> = {};
  for (const raw of lines.slice(start + 1)) {
    const line = raw.split("#")[0]!.trim();
    if (line.startsWith("[")) break; // 下一個 section
    const m = /^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

describe("wrangler vars 兩份同步（ADR-0354）", () => {
  const top = varsOf("vars");
  const unified = varsOf("env.unified.vars");

  it("讀得出兩份——讀不到就是這支測試自己壞了，而不是設定沒問題", () => {
    expect(Object.keys(top).length).toBeGreaterThan(0);
    expect(Object.keys(unified).length).toBeGreaterThan(0);
  });

  it("🔴 頂層有的每一個 var，統一模式也要有同樣的值", () => {
    const drift = Object.entries(top)
      .filter(([k, v]) => unified[k] !== v)
      .map(([k, v]) => `${k}：頂層 ${JSON.stringify(v)} ≠ unified ${JSON.stringify(unified[k])}`);
    expect(drift, drift.join("\n")).toEqual([]);
  });

  it("統一模式也不該偷偷多出頂層沒有的 var", () => {
    const extra = Object.keys(unified).filter((k) => !(k in top));
    expect(extra, `unified 多出：${extra.join("、")}`).toEqual([]);
  });
});

describe("速率限制 binding 兩份同步（ADR-0366 §容量）", () => {
  /** 讀出某個前綴底下所有 `[[…ratelimits]]` 的 name → "limit/period"。 */
  function limitsOf(prefix: string): Record<string, string> {
    const lines = TOML.split("\n");
    const out: Record<string, string> = {};
    let name = "";
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!.split("#")[0]!.trim();
      if (line === `[[${prefix}ratelimits]]`) {
        name = "";
        continue;
      }
      const n = /^name\s*=\s*"([^"]*)"$/.exec(line);
      if (n) name = n[1]!;
      if (line === `[${prefix}ratelimits.simple]` && name) {
        const limit = /^limit\s*=\s*(\d+)$/.exec(lines[i + 1]!.trim())?.[1];
        const period = /^period\s*=\s*(\d+)$/.exec(lines[i + 2]!.trim())?.[1];
        out[name] = `${limit}/${period}`;
      }
    }
    return out;
  }

  const top = limitsOf("");
  const unified = limitsOf("env.unified.");

  it("讀得出兩份——讀不到就是這支測試自己壞了", () => {
    expect(Object.keys(top).length).toBeGreaterThan(0);
    expect(Object.keys(unified).length).toBeGreaterThan(0);
  });

  it("🔴 車道升級限速必須存在——它是車道成本唯一擋在 DO 之前的那道", () => {
    // 沒有它的話，`worker.ts` 那段 `env.APP_LANE_LIMIT &&` 會靜默跳過，
    // 而症狀是「一切正常，只是帳單在漲」。
    expect(top["APP_LANE_LIMIT"]).toBeDefined();
  });

  it("🔴 頂層有的每一個 binding，統一模式也要有同樣的額度", () => {
    const drift = Object.entries(top)
      .filter(([k, v]) => unified[k] !== v)
      .map(([k, v]) => `${k}：頂層 ${v} ≠ unified ${unified[k]}`);
    expect(drift, drift.join("\n")).toEqual([]);
  });
});

describe("贊助管道（ADR-0089）", () => {
  it("設定的是完整的 https 網址，不是裸 ID", () => {
    // 客戶端的 `parseDonations` 走 `safeWebUrl`，裸 ID 會被整個丟掉——設了等於沒設。
    for (const [k, v] of Object.entries(varsOf("vars"))) {
      if (!k.startsWith("DONATE_") || k === "DONATE_LIGHTNING") continue;
      expect(v, k).toMatch(/^https:\/\/\S+$/);
    }
  });
});

describe("已知租戶名單（ADR-0366 §裁示）", () => {
  // 🔴 名單上的車道各有自己的 DO：**移除任何一個＝把它換到共用分片**，舊 DO 裡的資料不會跟著搬，
  // 對該遊戲而言就是資料消失、保存期從 30 天掉到 2 小時。所以「四款自家遊戲都在名單上」要釘住，
  // 要拿掉某一款必須先改這支測試——那一刻就會想起這段註解。
  // 2026-09-28 加入 dochost（DocHost 電子書閱讀器：劃線、筆記、書籤、閱讀進度的多裝置同步）
  // 2026-09-29 加入 cindersync、cinder-coffice（兩個 Obsidian 外掛，車道 id＝manifest id）
  const GAME_LANES = ["lwd", "elementalist", "nagd", "soleague", "dochost", "cindersync", "cinder-coffice"];

  it("自家應用都在名單上（頂層與統一模式）", () => {
    for (const section of ["vars", "env.unified.vars"]) {
      const lanes = (varsOf(section).APP_LANES ?? "").split(",").map((s) => s.trim());
      for (const id of GAME_LANES) expect(lanes, `${section} 缺 ${id}`).toContain(id);
    }
  });
});

describe("錨點的檔案車道（ADR-0371）", () => {
  // 2026-09-29 使用者決定：錨點只在 cindersync、cinder-coffice 兩條車道收檔案塊，單檔上限 30MB。
  const FILE_LANE_IDS = ["cindersync", "cinder-coffice"];
  const list = (raw: string | undefined): string[] =>
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  for (const section of ["vars", "env.unified.vars"]) {
    it(`${section}：FILE_LANES 就是那兩條、MAX_FILE_MB＝30`, () => {
      const v = varsOf(section);
      expect(list(v.FILE_LANES).sort()).toEqual([...FILE_LANE_IDS].sort());
      expect(v.MAX_FILE_MB).toBe("30");
    });

    it(`🔴 ${section}：FILE_LANES 的每一條都在 APP_LANES 上（不在的會被忽略＝設了沒用）`, () => {
      const v = varsOf(section);
      const app = list(v.APP_LANES);
      for (const id of list(v.FILE_LANES)) expect(app, `${section}：${id} 不在 APP_LANES`).toContain(id);
    });

    it(`🔴 ${section}：有 MAX_FILE_MB 就一定要有 FILE_LANES——少了它就是整站開放（ADR-0244 否決的選項 1）`, () => {
      const v = varsOf(section);
      if (v.MAX_FILE_MB !== undefined) expect(list(v.FILE_LANES).length).toBeGreaterThan(0);
    });
  }
});

describe("🔴 帳號儲存預算：所有可能 DO 的天花板加總 ≤ 免費 5 GB 的 80%（ADR-0377）", () => {
  // 2026-09-30 使用者決定：錨點在 Cloudflare 免費方案，DO SQLite 每帳號 5 GB，超過後整帳號同類操作失敗。
  const mib = (n: number): string => `${(n / MIB).toFixed(1)} MiB`;

  for (const section of ["vars", "env.unified.vars"]) {
    it(`${section}：DO_CEILINGS_MIB 有設、每一項都生效`, () => {
      const v = varsOf(section);
      expect(v.DO_CEILINGS_MIB, "錨點必須明寫天花板——沒設就是每顆 128/128 MiB、加總 10 GiB").toBeDefined();
      expect(doCeilings(v).ignored, "這些項目沒有生效（退回較大的預設值），預算不可信").toEqual([]);
    });

    it(`${section}：五個容量設定（含 ADR-0379 的預警與丟棄計數）每一項都生效`, () => {
      // 設錯的項目不生效＝退回較大的預設值或默默關掉，預算與「開了什麼」都不可信（SDK ADR 0042）
      expect(doCapacitySettings(varsOf(section)).ignored).toEqual([]);
    });

    it(`${section}：最壞加總 ≤ ${ACCOUNT_STORAGE_BUDGET_BYTES.toLocaleString("en-US")} bytes（含溢位帶；SDK ADR 0042 的 computeCeilingBudget）`, () => {
      const v = varsOf(section);
      const budget = computeCeilingBudget(v);
      expect(budget.ignored).toEqual([]);
      expect(budget.withinBudget).toBe(true);
      expect(budget.totalBytes).toBe(worstCaseStorage(v).totalBytes);
      const w = worstCaseStorage(v);
      const over = w.totalBytes - ACCOUNT_STORAGE_BUDGET_BYTES;
      const table = w.rows
        .map((r) => `  ${r.doName.padEnd(20)} ${r.cls.padEnd(6)} ${mib(r.ceiling.offlineMaxBytes)} + ${mib(r.ceiling.addressableMaxBytes)}（含溢位帶 ${mib(r.bytes)}）`)
        .join("\n");
      const advice = [
        `天花板加總 ${w.totalBytes.toLocaleString("en-US")} bytes（${mib(w.totalBytes)}）超過預算 ${over.toLocaleString("en-US")} bytes。`,
        `每多一條 APP_LANES 車道就多一顆 DO、多 \`lane\` 一份（目前 ${mib(w.laneCostBytes)}）。`,
        "請在 wrangler.toml 的 DO_CEILINGS_MIB 調低冷門的 DO（例如 strict、public、lane 類別或單顆 shard-x），",
        "或拿掉用不到的車道；兩份 vars 都要改，並在 ADR-0377 的分配表記下新數字。",
        "❌ 不要調大 ACCOUNT_STORAGE_BUDGET_BYTES——它是免費額度的 80%，不是可以協商的數字。",
        "每顆 DO（離線 + 可尋址）：",
        table,
      ].join("\n");
      expect(w.totalBytes, advice).toBeLessThanOrEqual(ACCOUNT_STORAGE_BUDGET_BYTES);
    });

    it(`${section}：dochost 有自己加大的可尋址天花板（SDK ADR 0036：全狀態可尋址桶）`, () => {
      const v = varsOf(section);
      expect(doCeilingFor(v, "app:dochost").addressableMaxBytes).toBeGreaterThanOrEqual(512 * MIB);
    });

    it(`${section}：檔案車道的離線天花板至少容得下一位收件人的整份最壞配額`, () => {
      // 否則一位收件人正常的同步量就會把自己的檔案塊淘汰掉（ADR-0371 §決策 4）。
      const v = varsOf(section);
      const worst = fileLaneChunksPerRecipient(Number(v.MAX_FILE_MB)) * FILE_EVENT_MAX_BYTES;
      for (const id of fileLanes(v).active) {
        expect(doCeilingFor(v, namedLaneName(id)).offlineMaxBytes, id).toBeGreaterThanOrEqual(worst);
      }
    });
  }
});

describe("容量訊號：開了哪些、哪些先不開（ADR-0379）", () => {
  // 2026-10-01 使用者核准：開粗分級預警與丟棄計數；溢位帶與保底先不開（理由與前置條件見 ADR-0379）。
  // 🔴 要開溢位帶或保底，先改這支測試——那一刻就會讀到為什麼不能開。
  for (const section of ["vars", "env.unified.vars"]) {
    it(`${section}：預警（80／95）與丟棄計數開在嚴格平面與檔案車道`, () => {
      const v = varsOf(section);
      for (const doName of ["global", "presence", "shard-0", "shard-a", "app:cindersync", "app:cinder-coffice"]) {
        const c = doCapacityFor(v, doName);
        expect(c.nearFullPercent, doName).toBe(80);
        expect(c.countDrops, doName).toBe(true);
      }
      // 名單上的一般車道：預警開、丟棄計數不開；共用分片兩者都不開
      expect(doCapacityFor(v, "app:dochost")).toMatchObject({ nearFullPercent: 80 });
      expect(doCapacityFor(v, "app:dochost").countDrops).toBeUndefined();
      expect(doCapacityFor(v, "app-0").nearFullPercent).toBeUndefined();
      expect(doCapacityFor(v, "app-0").countDrops).toBeUndefined();
    });

    it(`🔴 ${section}：溢位帶與保底都沒設（App v0.0.18 會把 2 小時的借用當成送達）`, () => {
      const v = varsOf(section);
      expect(v.DO_BORROW_PERCENT, "溢位帶要等 App 發版認得 warning: borrowed:（ADR-0379）").toBeUndefined();
      expect(v.DO_GUARANTEE_KIB, "保底要等各客戶端完成 SDK ADR 0038 P1（ADR-0379）").toBeUndefined();
      const budget = computeCeilingBudget(v);
      for (const row of budget.rows) {
        expect(row.capacity.overflowRatio, row.doName).toBeUndefined();
        expect(row.capacity.guaranteeBytes, row.doName).toBeUndefined();
      }
      // 沒有溢位帶：最壞量與 ADR-0377 的表逐位元相同
      expect(budget.totalBytes).toBe(3_724_541_952);
    });
  }
});
