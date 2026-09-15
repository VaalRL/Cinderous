import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROBES_PER_DAY,
  recordProbe,
  UPTIME_CAP,
  UPTIME_MIN_SAMPLES,
  UPTIME_WINDOW_DAYS,
  uptimePct,
  type UptimeRec,
} from "./uptime.js";

describe("滾動窗長度由探測頻率推導（ADR-0350）", () => {
  it("🔴 `PROBES_PER_DAY` 必須與 workflow 的 cron 一致——改一邊沒改另一邊即紅", () => {
    // 這條測試存在的理由：原本「≈30 天/時」是寫在註解裡的，而註解不會隨排程更新。
    const wf = readFileSync(new URL("../../.github/workflows/relay-health.yml", import.meta.url), "utf8");
    const cron = /cron:\s*"([^"]+)"/.exec(wf)?.[1];
    expect(cron, "找不到 cron（workflow 結構變了？）").toBeDefined();

    // 只支援本專案實際會用到的形狀：`<分> */<N> * * *` 或 `<分> * * * *`。
    const [, hour] = cron!.split(" ");
    const perDay = hour === "*" ? 24 : 24 / Number(/^\*\/(\d+)$/.exec(hour!)?.[1]);
    expect(perDay, `cron "${cron}" 換算每天 ${perDay} 次，與 PROBES_PER_DAY 不符`).toBe(PROBES_PER_DAY);
  });

  it("上限＝頻率 × 窗口天數（不是一個魔術數字）", () => {
    expect(UPTIME_CAP).toBe(PROBES_PER_DAY * UPTIME_WINDOW_DAYS);
    expect(UPTIME_CAP).toBe(120); // 4/天 × 30 天
  });

  it("最少樣本＝兩天", () => {
    expect(UPTIME_MIN_SAMPLES).toBe(PROBES_PER_DAY * 2);
  });
});

describe("recordProbe", () => {
  it("存活與不存活各自累加", () => {
    expect(recordProbe({ probes: 0, live: 0 }, true)).toEqual({ probes: 1, live: 1 });
    expect(recordProbe({ probes: 5, live: 5 }, false)).toEqual({ probes: 6, live: 5 });
  });

  it("到頂折半，保留比例", () => {
    const rec = recordProbe({ probes: 120, live: 60 }, true, 120); // 121 > 120
    expect(rec).toEqual({ probes: 61, live: 31 }); // 比例仍約 50%
    expect(uptimePct(rec)).toBeCloseTo(50.8, 0);
  });

  it("🔴 遠高於上限時一次收斂到窗內——頻率調降後的既有計數就是這種情況", () => {
    // 448 是實測值（改動當下 `health-history.json` 裡的數字）。單次折半要跑兩輪才進窗，
    // 期間的窗口長度是錯的；迴圈折半讓它一次到位。
    const rec = recordProbe({ probes: 448, live: 448 }, true, 120);
    expect(rec.probes).toBeLessThanOrEqual(120);
    expect(rec.live / rec.probes).toBeCloseTo(1, 2); // 100% 的可用率不因折半而失真
  });

  it("折半不會把可用率洗掉（連續多次仍維持比例）", () => {
    let rec: UptimeRec = { probes: 100, live: 90 };
    for (let i = 0; i < 200; i++) rec = recordProbe(rec, true, 120);
    expect(rec.probes).toBeLessThanOrEqual(120);
    expect(uptimePct(rec)!).toBeGreaterThan(95); // 之後一路存活 ⇒ 可用率該往上走
  });
});

describe("uptimePct", () => {
  it("樣本不足回 undefined（＝未知，維持試用）", () => {
    expect(uptimePct({ probes: UPTIME_MIN_SAMPLES - 1, live: 3 })).toBeUndefined();
  });

  it("樣本足夠即回百分比", () => {
    expect(uptimePct({ probes: 10, live: 10 })).toBe(100);
    expect(uptimePct({ probes: 10, live: 9 })).toBe(90);
  });

  it("🔴 undefined 與 0% 是不同的事——前者是「不知道」，後者是「確定全掛」", () => {
    expect(uptimePct({ probes: 2, live: 0 })).toBeUndefined();
    expect(uptimePct({ probes: 100, live: 0 })).toBe(0);
  });
});
