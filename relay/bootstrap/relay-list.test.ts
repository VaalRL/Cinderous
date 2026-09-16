import { describe, expect, it } from "vitest";
import { decideList, type ProbeOutcome } from "./relay-list.js";
import type { NodeConformance, ResolvedRelayEntry } from "@cinderous/core";

const ANCHOR_A = "wss://a.example";
const ANCHOR_B = "wss://b.example";

function entry(url: string, over: Partial<ResolvedRelayEntry> = {}): ResolvedRelayEntry {
  return { url, accepting: true, weight: 1, status: "ok", ...over };
}
/** 健康且一致性通過；uptime 預設 100 ⇒ 正式收錄。 */
function ok(uptimePct = 100): NodeConformance {
  return { live: true, ephemeral: true, rejectsExpired: true, uptimePct };
}
/** 探測失敗（`probeLive` 逾時／連線錯誤／真的死了——三者無法區分）。 */
const dead: NodeConformance = { live: false, ephemeral: false, rejectsExpired: false };

function outcomes(...pairs: [ResolvedRelayEntry, NodeConformance][]): ProbeOutcome[] {
  return pairs.map(([entry, conf]) => ({ entry, conf }));
}

describe("探測失敗不刪除（ADR-0353）", () => {
  it("🔴 一次 liveness 失敗不得把 relay 從 entries 移除——移除＝永遠不再被探測＝回不來", () => {
    // 這條測試存在的理由：2026-07-29 兩座錨點之一在累積 157/158（99.4%）之後探測失敗
    // 一次，被永久刪除，而它至今仍在正常服務——消失 7 週沒有任何告警。
    const a = entry(ANCHOR_A, { weight: 2 });
    const b = entry(ANCHOR_B, { weight: 2 });
    const d = decideList([a, b], outcomes([a, ok()], [b, dead]))!;

    expect(d.entries.map((e) => e.url)).toEqual([ANCHOR_A, ANCHOR_B]);
  });

  it("探測失敗的座標成不接受新分配，但客戶端拿去連的 relays 陣列不含它", () => {
    const a = entry(ANCHOR_A, { weight: 2 });
    const b = entry(ANCHOR_B, { weight: 2 });
    const d = decideList([a, b], outcomes([a, ok()], [b, dead]))!;

    // relays＝本輪存活的；客戶端行為因此完全不變。
    expect(d.relays).toEqual([ANCHOR_A]);
    // weight 原樣保留（accepting:false 之下用不到，但留著才看得出它本來是正式座）。
    expect(d.entries.find((e) => e.url === ANCHOR_B)).toEqual({ url: ANCHOR_B, accepting: false, weight: 2 });
  });

  it("🔴 失敗的座下一輪必須還在 active 裡——status 不能被改成 retired，否則就免探測了", () => {
    const a = entry(ANCHOR_A);
    const b = entry(ANCHOR_B);
    const d = decideList([a, b], outcomes([a, ok()], [b, dead]))!;

    expect(d.entries.find((e) => e.url === ANCHOR_B)!.status).toBeUndefined(); // 省略＝ok；`listEntries` 讀回來是 "ok" ⇒ 仍在 active
  });

  it("復活就自己回來：同一座下一輪探測成功即恢復正式收錄", () => {
    const a = entry(ANCHOR_A);
    const b = entry(ANCHOR_B, { accepting: false });
    const d = decideList([a, b], outcomes([a, ok()], [b, ok()]))!;

    expect(d.relays).toEqual([ANCHOR_A, ANCHOR_B]);
    expect(d.entries.find((e) => e.url === ANCHOR_B)).toEqual({ url: ANCHOR_B, weight: 2 });
  });
});

describe("never-empty 守門", () => {
  it("全滅回 null＝整份清單不動（全滅通常是探測端自己壞了，不是全世界同時死掉）", () => {
    const a = entry(ANCHOR_A);
    const b = entry(ANCHOR_B);
    expect(decideList([a, b], outcomes([a, dead], [b, dead]))).toBeNull();
  });

  it("🔴 它只防得住全滅——部分誤判正是它漏掉的那一格，所以才需要上面那條規則", () => {
    const a = entry(ANCHOR_A);
    const b = entry(ANCHOR_B);
    const d = decideList([a, b], outcomes([a, ok()], [b, dead]));
    expect(d).not.toBeNull(); // 守門不啟動 ⇒ 清單會被覆寫 ⇒ 舊寫法就是在這裡把 B 刪掉的
  });
});

describe("既有行為不變", () => {
  it("全部健康：分級收錄照舊（uptime≥99 ⇒ accepting＋weight 2）", () => {
    const a = entry(ANCHOR_A);
    const b = entry(ANCHOR_B);
    const d = decideList([a, b], outcomes([a, ok()], [b, ok()]))!;

    expect(d.relays).toEqual([ANCHOR_A, ANCHOR_B]);
    expect(d.entries).toEqual([{ url: ANCHOR_A, weight: 2 }, { url: ANCHOR_B, weight: 2 }]);
  });

  it("uptime 未知 ⇒ 試用（accepting:false、weight 1），但仍在 relays 裡", () => {
    const a = entry(ANCHOR_A);
    const d = decideList([a], outcomes([a, { live: true, ephemeral: true, rejectsExpired: true }]))!;

    expect(d.relays).toEqual([ANCHOR_A]);
    expect(d.entries).toEqual([{ url: ANCHOR_A, accepting: false }]);
  });

  it("draining 是人在手動退役，機器不碰它的欄位，但仍照常收進 relays", () => {
    const a = entry(ANCHOR_A);
    const draining = entry(ANCHOR_B, { status: "draining", weight: 3, accepting: false });
    const d = decideList([a, draining], outcomes([a, ok()], [draining, ok()]))!;

    expect(d.relays).toEqual([ANCHOR_A, ANCHOR_B]);
    expect(d.entries.find((e) => e.url === ANCHOR_B)).toEqual({
      url: ANCHOR_B,
      accepting: false,
      weight: 3,
      status: "draining",
    });
    // 機器不對 draining 做判定 ⇒ 不該有它的理由行
    expect(d.reasons.map((r) => r.url)).not.toContain(ANCHOR_B);
  });

  it("retired 免探測、原樣留存，且排在最後", () => {
    const a = entry(ANCHOR_A);
    const retired = entry(ANCHOR_B, { status: "retired" });
    // retired 不在 results 裡（health-check 的 active 已濾掉）
    const d = decideList([a, retired], outcomes([a, ok()]))!;

    expect(d.relays).toEqual([ANCHOR_A]);
    expect(d.entries.map((e) => e.url)).toEqual([ANCHOR_A, ANCHOR_B]);
    expect(d.entries[1]).toEqual({ url: ANCHOR_B, status: "retired" });
  });
});
