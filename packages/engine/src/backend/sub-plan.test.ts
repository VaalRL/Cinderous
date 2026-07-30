// 訂閱計畫的契約（P3／ADR-0293 §2.1、ADR-0294 §4）。
//
// P1 的教訓：FILE_WRAP 是 13 組訂閱 filter 裡唯二「會累積的儲存型 kind」，卻是唯一
// 沒有續取水位的一條——因為策略靠寫的人記得加。這支測試把它變成**擋得住的契約**：
// 新增累積型 kind 而沒宣告續取策略，CI 就紅。
import { describe, expect, it } from "vitest";
import { EK_ANNOUNCE_KIND, KIND, ORG_ROSTER_KIND, RELAY_LIST_KIND } from "@cinderous/core";
import { SNAPSHOT_KIND } from "@cinderous/core";
import { isAccumulatingKind, planFilters, sub, violations } from "./sub-plan.js";

describe("isAccumulatingKind：依 NIP-01 區間判定，不是手維護名單", () => {
  it("🔴 本專案實際用到的 kind 分類正確", () => {
    // 會累積（regular）——這兩個就是需要續取策略的
    expect(isAccumulatingKind(KIND.OFFLINE_DM_GIFT_WRAP)).toBe(true); // 1059
    expect(isAccumulatingKind(KIND.FILE_WRAP)).toBe(true); // 1060
    // ephemeral：中繼不留存
    expect(isAccumulatingKind(KIND.HEARTBEAT)).toBe(false); // 20000
    expect(isAccumulatingKind(KIND.TYPING)).toBe(false); // 20001
    expect(isAccumulatingKind(KIND.NUDGE)).toBe(false); // 20100
    // replaceable：每作者一顆
    expect(isAccumulatingKind(RELAY_LIST_KIND)).toBe(false); // 10037
    expect(isAccumulatingKind(ORG_ROSTER_KIND)).toBe(false); // 10038
    expect(isAccumulatingKind(EK_ANNOUNCE_KIND)).toBe(false); // 10040
    // addressable：每 (作者,d) 一顆
    expect(isAccumulatingKind(SNAPSHOT_KIND)).toBe(false); // 30078
  });

  it("區間邊界", () => {
    expect(isAccumulatingKind(0)).toBe(false); // 歷史特例：replaceable
    expect(isAccumulatingKind(3)).toBe(false);
    expect(isAccumulatingKind(1)).toBe(true);
    expect(isAccumulatingKind(9999)).toBe(true);
    expect(isAccumulatingKind(10000)).toBe(false);
    expect(isAccumulatingKind(39999)).toBe(false);
  });

  it("未分類區間（40000+）保守視為累積——寧可要求宣告，不要靜默漏抓", () => {
    expect(isAccumulatingKind(40000)).toBe(true);
  });
});

describe("violations：累積型必須宣告續取策略", () => {
  it("🔴 累積型 kind 標成 n/a → 違規（這正是 P1 的形狀）", () => {
    const bad = violations([sub({ kinds: [KIND.FILE_WRAP], "#p": ["me"] }, "n/a")]);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain("1060");
    expect(bad[0]).toContain("續取策略");
  });

  it("累積型 ＋ 水位函式 → 合法", () => {
    expect(violations([sub({ kinds: [KIND.FILE_WRAP] }, () => ({ since: 1 }))])).toEqual([]);
  });

  it('累積型 ＋ 明確 "full" → 合法（可以是對的選擇，但不能是「忘了想」）', () => {
    expect(violations([sub({ kinds: [KIND.OFFLINE_DM_GIFT_WRAP] }, "full")])).toEqual([]);
  });

  it("非累積型標 n/a → 合法", () => {
    expect(violations([sub({ kinds: [KIND.HEARTBEAT] }, "n/a")])).toEqual([]);
  });

  it("非累積型卻掛水位 → 也回報（通常代表誤解了那個 kind）", () => {
    const bad = violations([sub({ kinds: [KIND.HEARTBEAT] }, () => ({}))]);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain("不會累積");
  });

  it("一次列出全部違規，不被第一個打斷", () => {
    expect(
      violations([
        sub({ kinds: [KIND.FILE_WRAP] }, "n/a"),
        sub({ kinds: [KIND.OFFLINE_DM_GIFT_WRAP] }, "n/a"),
      ]),
    ).toHaveLength(2);
  });
});

describe("planFilters：套用策略並在違規時大聲失敗", () => {
  it("水位函式的結果併進 filter", () => {
    const out = planFilters([sub({ kinds: [KIND.FILE_WRAP], "#p": ["me"] }, () => ({ since: 42 }))], "wss://r");
    expect(out).toEqual([{ kinds: [KIND.FILE_WRAP], "#p": ["me"], since: 42 }]);
  });

  it("水位回 `{}`（這座中繼還沒水位）→ 本輪全量，filter 不變", () => {
    const out = planFilters([sub({ kinds: [KIND.FILE_WRAP] }, () => ({}))], undefined);
    expect(out).toEqual([{ kinds: [KIND.FILE_WRAP] }]);
  });

  it('"full" 與 "n/a" 都不改 filter', () => {
    expect(planFilters([sub({ kinds: [KIND.HEARTBEAT] }, "n/a")], "u")).toEqual([{ kinds: [KIND.HEARTBEAT] }]);
    expect(planFilters([sub({ kinds: [KIND.FILE_WRAP] }, "full")], "u")).toEqual([{ kinds: [KIND.FILE_WRAP] }]);
  });

  it("🔴 違規直接丟——那是程式錯誤，不該靜默送出漏抓的訂閱（ADR-0122 同立場）", () => {
    expect(() => planFilters([sub({ kinds: [KIND.FILE_WRAP] }, "n/a")], "u")).toThrow(/P3/);
  });

  it("水位函式拿得到 url——逐中繼水位是必須的（不同中繼的事件集合不同）", () => {
    const seen: (string | undefined)[] = [];
    planFilters([sub({ kinds: [KIND.FILE_WRAP] }, (u) => (seen.push(u), {}))], "wss://a");
    expect(seen).toEqual(["wss://a"]);
  });
});
