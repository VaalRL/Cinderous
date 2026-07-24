import { describe, expect, it } from "vitest";
import { mergeSyncedPrefs, type SyncedPrefs } from "./synced-prefs.js";

// 同步設定的逐鍵 LWW 合併（ADR-0242 階段③）：設定/偏好跨裝置收斂。

describe("mergeSyncedPrefs（逐鍵 LWW，ADR-0242 階段③）", () => {
  it("聯集：兩端各有的鍵都保留", () => {
    const a: SyncedPrefs = { "mute:g1": { v: "1", at: 1 } };
    const b: SyncedPrefs = { "status:text": { v: "在忙", at: 1 } };
    expect(mergeSyncedPrefs(a, b)).toEqual({ "mute:g1": { v: "1", at: 1 }, "status:text": { v: "在忙", at: 1 } });
  });

  it("同鍵取較新（at 大者勝）", () => {
    const a: SyncedPrefs = { "mute:g1": { v: "1", at: 1 } };
    const b: SyncedPrefs = { "mute:g1": { v: "", at: 2 } }; // 另一台後來解除靜音
    expect(mergeSyncedPrefs(a, b)).toEqual({ "mute:g1": { v: "", at: 2 } });
  });

  it("清除（v 空）也是一次設定：較新的清除蓋過較舊的設值", () => {
    const a: SyncedPrefs = { "mute:g1": { v: "1", at: 5 } };
    const b: SyncedPrefs = { "mute:g1": { v: "", at: 3 } };
    expect(mergeSyncedPrefs(a, b)["mute:g1"]).toEqual({ v: "1", at: 5 }); // a 較新 → 保持靜音
  });

  it("交換律：merge(a,b) == merge(b,a)（含平手用 v 字典序）", () => {
    const a: SyncedPrefs = { k: { v: "x", at: 1 }, tie: { v: "aaa", at: 9 } };
    const b: SyncedPrefs = { k: { v: "y", at: 2 }, tie: { v: "bbb", at: 9 } };
    expect(mergeSyncedPrefs(a, b)).toEqual(mergeSyncedPrefs(b, a));
    expect(mergeSyncedPrefs(a, b)).toEqual({ k: { v: "y", at: 2 }, tie: { v: "aaa", at: 9 } }); // tie: aaa <= bbb
  });

  it("冪等：與自己合併不變", () => {
    const a: SyncedPrefs = { "mute:g1": { v: "1", at: 1 }, "mute:g2": { v: "", at: 2 } };
    expect(mergeSyncedPrefs(a, a)).toEqual(a);
  });
});
