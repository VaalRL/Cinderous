import { describe, expect, it } from "vitest";
import {
  buildTriggerIndex,
  matchTriggers,
  renameTrigger,
  normalizeTrigger,
  removeTrigger,
  removeTriggersFor,
  setTrigger,
  TRIGGER_MAX_LEN,
  TRIGGERS_MAX,
  triggersFor,
  type TriggerEntry,
} from "./sticker-triggers.js";

const ref = (id: string, pack = "buddy") => ({ pack, id });
const entry = (trigger: string, id: string): TriggerEntry => ({ trigger, ref: ref(id) });

describe("觸發字正規化與 CRUD（ADR-0037）", () => {
  it("normalize：trim、拉丁字母小寫；空/超長不合法", () => {
    expect(normalizeTrigger("  LoL ")).toBe("lol");
    expect(normalizeTrigger("哈哈")).toBe("哈哈");
    expect(normalizeTrigger("   ")).toBeUndefined();
    expect(normalizeTrigger("x".repeat(TRIGGER_MAX_LEN + 1))).toBeUndefined();
  });

  it("setTrigger：新增、同觸發字覆蓋並回報原參照、同參照冪等", () => {
    let r = setTrigger([], "哈哈", ref("cat"));
    expect(r.ok && r.list).toEqual([{ trigger: "哈哈", ref: ref("cat") }]);
    if (!r.ok) throw new Error("unexpected");
    const again = setTrigger(r.list, "哈哈", ref("cat"));
    expect(again.ok && again.list).toBe(r.list); // 冪等
    r = setTrigger(r.list, "哈哈", ref("dog"));
    expect(r.ok && r.replaced).toEqual(ref("cat"));
    expect(r.ok && r.list[0]!.ref).toEqual(ref("dog"));
  });

  it("總數上限與非法觸發字被拒", () => {
    const full = Array.from({ length: TRIGGERS_MAX }, (_, i) => entry(`t${i}`, "x"));
    expect(setTrigger(full, "溢出", ref("y"))).toEqual({ ok: false, reason: "full" });
    expect(setTrigger([], "  ", ref("y"))).toEqual({ ok: false, reason: "invalid" });
  });

  it("removeTrigger / triggersFor / removeTriggersFor", () => {
    const list = [entry("哈哈", "cat"), entry("喵", "cat"), entry("汪", "dog")];
    expect(removeTrigger(list, "哈哈")).toHaveLength(2);
    expect(triggersFor(list, ref("cat"))).toEqual(["哈哈", "喵"]);
    expect(removeTriggersFor(list, ref("cat"))).toEqual([entry("汪", "dog")]);
  });
});

describe("renameTrigger（管理面板用）", () => {
  const list = [entry("哈哈", "cat"), entry("汪", "dog")];

  it("改名保留參照；同名冪等；舊字不存在回報 missing；新字非法回報 invalid", () => {
    const r = renameTrigger(list, "哈哈", "嘻嘻");
    expect(r.ok && r.list).toContainEqual(entry("嘻嘻", "cat"));
    expect(r.ok && r.list).not.toContainEqual(entry("哈哈", "cat"));
    expect(renameTrigger(list, "哈哈", " 哈哈 ")).toEqual({ ok: true, list });
    expect(renameTrigger(list, "不存在", "x")).toEqual({ ok: false, reason: "missing" });
    expect(renameTrigger(list, "哈哈", "  ")).toEqual({ ok: false, reason: "invalid" });
  });

  it("改名撞上既有觸發字：覆蓋並回報 replaced", () => {
    const r = renameTrigger(list, "哈哈", "汪");
    expect(r.ok && r.replaced).toEqual(ref("dog"));
    if (!r.ok) throw new Error("unexpected");
    expect(r.list).toEqual([entry("汪", "cat")]);
  });
});

describe("字首索引 buildTriggerIndex（ADR-0037 後續）", () => {
  it("索引路徑與全掃描結果完全一致（含中英混雜與代理對字首）", () => {
    const list = [
      entry("哈哈", "a"),
      entry("哈囉", "b"),
      entry("喵", "c"),
      entry("lol", "d"),
      entry("laugh", "e"),
      entry("😂笑", "f"), // 代理對字首
    ];
    const index = buildTriggerIndex(list);
    const samples = ["今天真好笑哈哈", "哈", "小貓喵", "笑死 LO", "😂", "xx😂笑", "完全無關", ""];
    for (const text of samples) {
      expect(matchTriggers(text, list, index), text).toEqual(matchTriggers(text, list));
    }
  });

  it("索引桶依字首分組", () => {
    const index = buildTriggerIndex([entry("哈哈", "a"), entry("哈囉", "b"), entry("喵", "c")]);
    expect(index.get("哈")).toHaveLength(2);
    expect(index.get("喵")).toHaveLength(1);
    expect(index.get("汪")).toBeUndefined();
  });
});

describe("尾端比對 matchTriggers（ADR-0037）", () => {
  const list = [entry("哈哈", "laugh"), entry("哈囉", "hello"), entry("喵", "cat"), entry("lol", "lol")];

  it("尾端前綴 ≥2 即建議；完整命中優先、命中長度降冪", () => {
    // 「哈哈」完整命中 laugh；同時是「哈囉」的 1 字前綴（不足 2）→ 只有 laugh
    expect(matchTriggers("今天真好笑哈哈", list).map((m) => m.entry.ref.id)).toEqual(["laugh"]);
    // 「哈」單字尾端：是兩個觸發字的 1 字前綴 → 都不建議
    expect(matchTriggers("哈", list)).toEqual([]);
  });

  it("單字觸發需完整命中", () => {
    const m = matchTriggers("小貓喵", list);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ matchedLen: 1, exact: true });
  });

  it("拉丁字母不分大小寫；matchedLen 供剝離", () => {
    const m = matchTriggers("笑死 LO", list); // "lo" 是 lol 的 2 字前綴
    expect(m[0]!.entry.ref.id).toBe("lol");
    expect(m[0]).toMatchObject({ matchedLen: 2, exact: false });
  });

  it("部分前綴命中多個時依規則排序，且不超過 5 筆", () => {
    const many = [
      entry("哈哈", "a"),
      entry("哈哈哈", "b"),
      entry("哈哈笑", "c"),
      entry("哈哈嗚", "d"),
      entry("哈哈耶", "e"),
      entry("哈哈唷", "f"),
    ];
    const m = matchTriggers("哈哈", many);
    expect(m).toHaveLength(5);
    expect(m[0]!.entry.trigger).toBe("哈哈"); // 完整命中排最前
    expect(m[0]!.exact).toBe(true);
  });

  it("空字串或無命中回傳空陣列", () => {
    expect(matchTriggers("", list)).toEqual([]);
    expect(matchTriggers("完全無關", list)).toEqual([]);
  });
});
