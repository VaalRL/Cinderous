// FS 開關的多裝置合併（ADR-0334）。
import { describe, expect, it } from "vitest";
import { mergeFsEnabled } from "./fs-enabled-merge.js";

describe("FS 開關合併（ADR-0334）", () => {
  it("🔴 較新的停用勝過較舊的啟用——這正是舊的 OR 做不到的那件事", () => {
    expect(mergeFsEnabled({ enabled: false, at: 200 }, { enabled: true, at: 100 })).toEqual({
      enabled: false,
      at: 200,
    });
  });

  it("較新的啟用勝過較舊的停用（另一個方向也要對）", () => {
    expect(mergeFsEnabled({ enabled: false, at: 100 }, { enabled: true, at: 200 })).toEqual({
      enabled: true,
      at: 200,
    });
  });

  it("🔴 只有本機表態過 → 本機贏（舊版快照不得撤銷使用者剛剛的決定）", () => {
    expect(mergeFsEnabled({ enabled: false, at: 500 }, { enabled: true })).toEqual({ enabled: false, at: 500 });
  });

  it("只有遠端表態過 → 遠端贏（本機還沒升級）", () => {
    expect(mergeFsEnabled({ enabled: false }, { enabled: true, at: 500 })).toEqual({ enabled: true, at: 500 });
  });

  it("🔴 兩邊都沒有時間戳 → 沿用舊的 OR：升級當下不改變任何人的狀態", () => {
    expect(mergeFsEnabled({ enabled: false }, { enabled: true })).toEqual({ enabled: true });
    expect(mergeFsEnabled({ enabled: false }, { enabled: false })).toEqual({ enabled: false });
  });

  it("🔴 同一毫秒平手 → 偏向啟用（「多加密了」比「以為加密其實沒有」安全）", () => {
    expect(mergeFsEnabled({ enabled: false, at: 7 }, { enabled: true, at: 7 })).toEqual({ enabled: true, at: 7 });
  });

  it("平手且兩邊都停用 → 停用（不無中生有）", () => {
    expect(mergeFsEnabled({ enabled: false, at: 7 }, { enabled: false, at: 7 })).toEqual({ enabled: false, at: 7 });
  });
});
