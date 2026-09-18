import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  historyOrThrow,
  PROBES_PER_DAY,
  recordProbe,
  toRec,
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

/** 由 "1"/"0" 字串直接造一筆紀錄，讓斷言讀起來就是那段歷史本身。 */
const rec = (window: string): UptimeRec => ({ window });

describe("recordProbe（ADR-0360：真的滑動視窗）", () => {
  it("append 在最後——最新的在右邊", () => {
    expect(recordProbe(rec(""), true)).toEqual(rec("1"));
    expect(recordProbe(rec("11111"), false)).toEqual(rec("111110"));
  });

  it("滿了就從最舊那端擠掉", () => {
    expect(recordProbe(rec("01111"), true, 5)).toEqual(rec("11111"));
    expect(recordProbe(rec("0111111111"), true, 5)).toEqual(rec("11111"));
  });

  it("🔴 一次失敗不得讓權重永遠震盪——這正是舊的「折半」造成的", () => {
    // 舊實作把 probes/live 同時折半，保留的是**比例**，所以那一次失敗永遠洗不掉；
    // 而樣本數變小又讓它在比例裡份量變重，於是 99% 那道懸崖被反覆跨過：
    //   100/99 → 99.00%（weight 2）→ 折半 → 61/60 → 98.36%（weight 1）→ 爬回 → …
    // 一座連續 300 次全部成功的 relay 每五天被降級一次，原因是三個月前的一次逾時。
    let r: UptimeRec = rec("0"); // 第一次就掛
    const seen = new Set<boolean>();
    for (let i = 0; i < 400; i += 1) {
      r = recordProbe(r, true); // 之後每一次都成功
      if (r.window.length >= UPTIME_MIN_SAMPLES) seen.add(uptimePct(r)! >= 99);
    }
    expect(r.window).toBe("1".repeat(UPTIME_CAP)); // 那次失敗真的滑出去了
    expect(uptimePct(r)).toBe(100);
    // 收斂之後不再回頭：最後 100 次全都在 99% 以上。
    expect(seen.has(true)).toBe(true);
  });

  it("失敗滿一個窗口就真的消失（這是「衰減」原本想要的意思）", () => {
    let r = rec("0" + "1".repeat(UPTIME_CAP - 1));
    expect(uptimePct(r)!).toBeLessThan(100);
    r = recordProbe(r, true); // 再一次成功即把最舊的那個 "0" 擠出去
    expect(uptimePct(r)).toBe(100);
  });

  it("一個窗口內只有一次失敗仍是正式收錄（≥99%）——規則講得出口", () => {
    const one = rec("0" + "1".repeat(UPTIME_CAP - 1));
    expect(uptimePct(one)!).toBeGreaterThanOrEqual(99);
    const two = rec("00" + "1".repeat(UPTIME_CAP - 2));
    expect(uptimePct(two)!).toBeLessThan(99);
  });
});

describe("uptimePct", () => {
  it("樣本不足回 undefined（＝未知，維持試用）", () => {
    expect(uptimePct(rec("1".repeat(UPTIME_MIN_SAMPLES - 1)))).toBeUndefined();
  });

  it("樣本足夠即回百分比", () => {
    expect(uptimePct(rec("1".repeat(10)))).toBe(100);
    expect(uptimePct(rec("0" + "1".repeat(9)))).toBe(90);
  });

  it("🔴 undefined 與 0% 是不同的事——前者是「不知道」，後者是「確定全掛」", () => {
    expect(uptimePct(rec("00"))).toBeUndefined();
    expect(uptimePct(rec("0".repeat(100)))).toBe(0);
  });
});

describe("toRec：舊形遷移（ADR-0360）", () => {
  it("沒有紀錄＝空視窗", () => {
    expect(toRec(undefined)).toEqual(rec(""));
    expect(toRec({ probes: 0, live: 0 })).toEqual(rec(""));
  });

  it("新形原樣通過（只裁到上限）", () => {
    expect(toRec(rec("1010"))).toEqual(rec("1010"));
    expect(toRec(rec("1".repeat(UPTIME_CAP + 10)))).toEqual(rec("1".repeat(UPTIME_CAP)));
  });

  it("全數存活 → 全 1", () => {
    expect(toRec({ probes: 66, live: 66 })).toEqual(rec("1".repeat(66)));
  });

  it("🔴 失敗均勻散佈，不擠在任何一端——我們查不回它何時發生，擠哪一邊都是在編造資訊", () => {
    const r = toRec({ probes: 10, live: 8 });
    expect(r.window.length).toBe(10);
    expect([...r.window].filter((c) => c === "0").length).toBe(2);
    expect(r.window.startsWith("00")).toBe(false);
    expect(r.window.endsWith("00")).toBe(false);
  });

  it("超過上限只留最近一個窗口的份量，比例不失真", () => {
    const r = toRec({ probes: 448, live: 448 });
    expect(r.window.length).toBe(UPTIME_CAP);
    expect(uptimePct(r)).toBe(100);
  });

  it("實測的那一筆：89 次 1 次失敗 → 遷移後仍是 98.9%，但之後三天就爬得回去", () => {
    let r = toRec({ probes: 89, live: 88 });
    expect(uptimePct(r)!).toBeCloseTo(98.88, 1);
    for (let i = 0; i < 12; i += 1) r = recordProbe(r, true);
    expect(uptimePct(r)!).toBeGreaterThanOrEqual(99); // 12 次探測＝3 天
  });
});

describe("historyOrThrow：檔案不存在 ≠ 空歷史（ADR-0350 遷移後）", () => {
  it("🔴 檔案不存在就拋——空歷史會把正式收錄的 relay 降級成試用", () => {
    // 這條測試守的不是「讀檔」，是那條因果鏈：{} ⇒ uptimePct undefined ⇒
    // evaluateAdmission 回 accepting:false ⇒ 降級後的 relays.json 被寫回（甚至簽章發佈）。
    expect(() => historyOrThrow(undefined)).toThrow(/health-history\.json/);
  });

  it("錯誤訊息要講得出怎麼把狀態取回來，否則遇到的人只會把守衛拆掉", () => {
    let message = "";
    try {
      historyOrThrow(undefined);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("relay-health-state");
    expect(message).toContain("git show FETCH_HEAD:health-history.json");
    expect(message).toContain("RELAY_HEALTH_COLD_START=1");
  });

  it("明示冷啟動才放行，且要留下警告", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(historyOrThrow(undefined, true)).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("🔴 壞掉的 JSON 也要拋，不能退化成空歷史——後果與檔案不在完全相同", () => {
    expect(() => historyOrThrow("{ 這不是 JSON")).toThrow();
    // 冷啟動旗標只赦免「檔案不存在」，不赦免「內容壞掉」：後者代表狀態分支有問題，
    // 靜默當成空的等於把 bug 變成 relay 降級。
    expect(() => historyOrThrow("{ 這不是 JSON", true)).toThrow();
  });

  it("正常內容照常解析，且舊形在讀進來時就遷移（ADR-0360）", () => {
    const raw = JSON.stringify({
      "wss://a.example": { probes: 10, live: 10 }, // 舊形
      "wss://b.example": { window: "1101" }, // 新形
    });
    const h = historyOrThrow(raw);
    expect(h["wss://a.example"]).toEqual({ window: "1111111111" });
    expect(h["wss://b.example"]).toEqual({ window: "1101" });
  });
});

describe("workflow 不再有「分支不存在就用種子」那條退路（遷移已完成）", () => {
  it("🔴 取回狀態那一步必須是無條件的——有退路就等於允許安靜降級", () => {
    const wf = readFileSync(new URL("../../.github/workflows/relay-health.yml", import.meta.url), "utf8");
    const step = wf.slice(wf.indexOf("name: 取回 uptime 狀態"), wf.indexOf("name: 探測"));
    expect(step).toContain("git fetch --depth=1 origin");
    // 首次遷移用的 fallback（`if git fetch … else ::warning:: …`）必須已經拿掉。
    expect(step).not.toContain("::warning::");
    expect(step).not.toMatch(/\bif git fetch\b/);
  });

  it("🔴 種子檔必須被 .gitignore——否則本機跑一次 bootstrap:run 就會把它請回 main", () => {
    // 故意不斷言「檔案不存在」：維護者本機取回狀態來跑完整探測是正常操作，
    // 那不該讓測試變紅。真正要守的是**它不會再被追蹤**。
    const ignore = readFileSync(new URL("../../.gitignore", import.meta.url), "utf8");
    expect(ignore).toContain("relay/bootstrap/health-history.json");
  });
});

describe("狀態分支上的檔案路徑必須讓 ADR-0212 的 CF 排除規則對得上", () => {
  const wf = () => readFileSync(new URL("../../.github/workflows/relay-health.yml", import.meta.url), "utf8");

  it("🔴 狀態分支上的路徑必須等於 $HISTORY，而且每一層目錄都真的建了 tree", () => {
    // ADR-0212 在 CF 儀表板設了 Build watch paths「Exclude: relay/bootstrap/*」。
    // ADR-0350 把這個檔案搬到狀態分支時，一度放在**分支根目錄** ⇒ 排除規則對不上 ⇒
    // 每次 force-push 都觸發一個必定失敗的 Workers Build（該分支沒有 apps/desktop，
    // CF 報 `root directory not found`）。實測 4 次推送 4 次失敗。
    //
    // ⚠ 注意 `HISTORY` 這個 env 指的是**工作目錄裡**的路徑，它從頭到尾都是對的——
    // 出問題的是 plumbing 建出來的 **tree 結構**。所以這裡要驗的是兩者一致，
    // 只斷言 env 本身等於白費工夫（舊寫法下它照樣會過）。
    const text = wf();
    const history = /HISTORY:\s*(\S+)/.exec(text)?.[1];
    expect(history, "workflow 裡找不到 HISTORY env").toBeDefined();
    expect(history!.startsWith("relay/bootstrap/"), `HISTORY=${history} 不在排除規則涵蓋範圍內`).toBe(true);

    const saveStep = text.slice(text.indexOf("name: 保存 uptime 狀態"), text.indexOf("name: 提交清單變更"));
    const segments = history!.split("/");
    const file = segments.pop()!;
    expect(saveStep).toContain(String.raw`100644 blob %s\t${file}\n`);
    for (const dir of segments) {
      expect(saveStep, `${dir}/ 這一層沒有建 tree ⇒ 檔案不會落在 ${history}`).toContain(
        String.raw`040000 tree %s\t${dir}\n`,
      );
    }
  });

  it("🔴 讀取端要用同一個 $HISTORY，不要另外寫死檔名——寫死就會與寫入端各自漂移", () => {
    const text = wf();
    const fetchStep = text.slice(text.indexOf("name: 取回 uptime 狀態"), text.indexOf("name: 探測"));
    expect(fetchStep).toContain('git show "FETCH_HEAD:$HISTORY"');
  });
});
