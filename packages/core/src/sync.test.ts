import { describe, expect, it } from "vitest";
import { DeviceSyncState, type SyncDelta } from "./sync.js";

const msg = (id: string) => ({ id });

describe("多設備增量同步對帳", () => {
  it("訊息以 id 去重", () => {
    const d = new DeviceSyncState();
    d.apply({ messages: [msg("a"), msg("b")] });
    d.apply({ messages: [msg("b"), msg("c")] });
    expect(d.messageIds().sort()).toEqual(["a", "b", "c"]);
  });

  it("可變狀態採 last-writer-wins（較新 updatedAt 勝）", () => {
    const d = new DeviceSyncState();
    d.apply({ state: { nickname: { value: "舊", updatedAt: 100 } } });
    d.apply({ state: { nickname: { value: "新", updatedAt: 200 } } });
    expect(d.get("nickname")).toBe("新");
    // 較舊的更新不應覆蓋
    d.apply({ state: { nickname: { value: "更舊", updatedAt: 50 } } });
    expect(d.get("nickname")).toBe("新");
  });

  it("不同套用順序最終收斂一致（commutative）", () => {
    const deltaA: SyncDelta = {
      messages: [msg("a"), msg("b")],
      state: { read: { value: "10", updatedAt: 1 }, block: { value: "bob", updatedAt: 5 } },
    };
    const deltaB: SyncDelta = {
      messages: [msg("b"), msg("c")],
      state: { read: { value: "20", updatedAt: 9 }, block: { value: "none", updatedAt: 2 } },
    };

    const d1 = new DeviceSyncState();
    d1.apply(deltaA);
    d1.apply(deltaB);

    const d2 = new DeviceSyncState();
    d2.apply(deltaB);
    d2.apply(deltaA);

    expect(d1.messageIds().sort()).toEqual(d2.messageIds().sort());
    expect(d1.get("read")).toBe(d2.get("read"));
    expect(d1.get("block")).toBe(d2.get("block"));
    // LWW 結果：read 取 updatedAt=9 的 "20"，block 取 updatedAt=5 的 "bob"
    expect(d1.get("read")).toBe("20");
    expect(d1.get("block")).toBe("bob");
  });
});
