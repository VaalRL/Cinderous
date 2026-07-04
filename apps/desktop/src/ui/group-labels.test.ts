import { beforeEach, describe, expect, it } from "vitest";
import {
  allLabels,
  arrangeGroups,
  type GroupPrefsMap,
  isPinned,
  labelsOf,
  loadGroupPrefs,
  normalizeLabel,
  pruneGroup,
  saveGroupPrefs,
  withLabel,
  withoutLabel,
  withPinned,
} from "./group-labels.js";

describe("normalizeLabel", () => {
  it("收斂空白、去頭尾、限制長度", () => {
    expect(normalizeLabel("  工作   群組 ")).toBe("工作 群組");
    expect(normalizeLabel("a".repeat(40))).toHaveLength(24);
    expect(normalizeLabel("   ")).toBe("");
  });
});

describe("withLabel / withoutLabel（不可變）", () => {
  it("加標籤：正規化、去重、忽略空字串", () => {
    let m: GroupPrefsMap = {};
    m = withLabel(m, "g1", "  家人 ");
    expect(labelsOf(m, "g1")).toEqual(["家人"]);
    // 重複（正規化後相同）不再加入，且回傳同一參考
    const same = withLabel(m, "g1", "家人");
    expect(same).toBe(m);
    // 空字串忽略
    expect(withLabel(m, "g1", "   ")).toBe(m);
    m = withLabel(m, "g1", "工作");
    expect(labelsOf(m, "g1")).toEqual(["家人", "工作"]);
  });

  it("移除標籤；不存在時回傳原 map", () => {
    let m: GroupPrefsMap = withLabel(withLabel({}, "g1", "家人"), "g1", "工作");
    m = withoutLabel(m, "g1", "家人");
    expect(labelsOf(m, "g1")).toEqual(["工作"]);
    expect(withoutLabel(m, "g1", "不存在")).toBe(m);
    expect(withoutLabel(m, "無此群", "x")).toBe(m);
  });

  it("不改動輸入 map", () => {
    const m: GroupPrefsMap = {};
    withLabel(m, "g1", "家人");
    expect(m).toEqual({});
  });
});

describe("withPinned / isPinned", () => {
  it("預設未置頂，可切換", () => {
    let m: GroupPrefsMap = {};
    expect(isPinned(m, "g1")).toBe(false);
    m = withPinned(m, "g1", true);
    expect(isPinned(m, "g1")).toBe(true);
    // 置頂不影響既有標籤
    m = withLabel(m, "g1", "家人");
    m = withPinned(m, "g1", false);
    expect(isPinned(m, "g1")).toBe(false);
    expect(labelsOf(m, "g1")).toEqual(["家人"]);
  });
});

describe("allLabels", () => {
  it("跨群組去重並排序", () => {
    let m: GroupPrefsMap = {};
    m = withLabel(m, "g1", "工作");
    m = withLabel(m, "g2", "家人");
    m = withLabel(m, "g2", "工作");
    expect(allLabels(m)).toEqual(["家人", "工作"]);
  });
});

describe("arrangeGroups", () => {
  const groups = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("置頂者排前面、同組維持原序", () => {
    const m = withPinned({}, "c", true);
    expect(arrangeGroups(groups, m).map((g) => g.id)).toEqual(["c", "a", "b"]);
  });

  it("依 activeLabel 過濾", () => {
    let m: GroupPrefsMap = {};
    m = withLabel(m, "a", "工作");
    m = withLabel(m, "c", "工作");
    expect(arrangeGroups(groups, m, "工作").map((g) => g.id)).toEqual(["a", "c"]);
    expect(arrangeGroups(groups, m, "家人")).toEqual([]);
  });

  it("過濾 + 置頂同時作用", () => {
    let m: GroupPrefsMap = {};
    m = withLabel(m, "a", "工作");
    m = withLabel(m, "c", "工作");
    m = withPinned(m, "c", true);
    expect(arrangeGroups(groups, m, "工作").map((g) => g.id)).toEqual(["c", "a"]);
  });

  it("不改動輸入陣列", () => {
    const copy = [...groups];
    arrangeGroups(groups, withPinned({}, "c", true));
    expect(groups).toEqual(copy);
  });
});

describe("pruneGroup", () => {
  it("清除某群組偏好；不存在時回傳原 map", () => {
    const m = withLabel({}, "g1", "家人");
    expect(pruneGroup(m, "g1")).toEqual({});
    expect(pruneGroup(m, "無此群")).toBe(m);
  });
});

describe("load / save（localStorage 往返）", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it("空/缺失回傳空 map", () => {
    expect(loadGroupPrefs()).toEqual({});
  });

  it("往返保存標籤與置頂", () => {
    let m: GroupPrefsMap = {};
    m = withLabel(m, "g1", "家人");
    m = withPinned(m, "g1", true);
    saveGroupPrefs(m);
    expect(loadGroupPrefs()).toEqual({ g1: { labels: ["家人"], pinned: true } });
  });

  it("毀損內容不丟例外、回傳空 map", () => {
    localStorage.setItem("nb.groupPrefs", "{壞掉");
    expect(loadGroupPrefs()).toEqual({});
  });

  it("非法形狀被過濾為安全預設", () => {
    localStorage.setItem("nb.groupPrefs", JSON.stringify({ g1: { labels: ["ok", 3, null], pinned: "yes" }, g2: 7 }));
    expect(loadGroupPrefs()).toEqual({ g1: { labels: ["ok"], pinned: false }, g2: { labels: [], pinned: false } });
  });
});
