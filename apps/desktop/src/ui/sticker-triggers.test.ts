import { describe, expect, it } from "vitest";
import {
  matchTriggers,
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
