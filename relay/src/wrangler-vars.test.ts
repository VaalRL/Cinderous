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
  const GAME_LANES = ["lwd", "elementalist", "nagd", "soleague"];

  it("四款自家遊戲都在名單上（頂層與統一模式）", () => {
    for (const section of ["vars", "env.unified.vars"]) {
      const lanes = (varsOf(section).APP_LANES ?? "").split(",").map((s) => s.trim());
      for (const id of GAME_LANES) expect(lanes, `${section} 缺 ${id}`).toContain(id);
    }
  });
});
