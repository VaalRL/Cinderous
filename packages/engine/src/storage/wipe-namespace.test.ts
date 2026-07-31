// 清除單一身分的本機命名空間（ADR-0202）。
//
// 為什麼搬到 engine：桌面 `native/wipe.ts` 早有這個純函式，但**行動端沒有**——
// 行動端的「移除此身分」只刪了 nsec blob（`deleteRemembered`），
// 命名空間資料（含 `fsState` 的 EK 私鑰）整批留在 localStorage。
// 那與 ADR-0202 的決策「唯一能徹底移除身分的方式是**刪本機資料**」不符。
// Fix First：搬到共用層一份，兩端都用它，而不是在行動端再寫一次。
import { beforeEach, describe, expect, it } from "vitest";
import { clearStorageNamespace } from "./wipe-namespace.js";

/** 極簡 localStorage 替身（只需 length／key／getItem／setItem／removeItem）。 */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
}

describe("clearStorageNamespace（ADR-0202）", () => {
  let s: Storage;
  beforeEach(() => {
    s = fakeStorage();
    s.setItem("nb.alice.fsState", "ek 私鑰在這裡");
    s.setItem("nb.alice.messages", "訊息");
    s.setItem("nb.bob.fsState", "別人的");
    s.setItem("nb.profiles", "全域登錄");
    s.setItem("nb.deviceId", "裝置級");
  });

  it("🔴 清掉該身分的全部鍵——含 fsState（EK 私鑰）", () => {
    clearStorageNamespace("alice", s);
    expect(s.getItem("nb.alice.fsState")).toBeNull();
    expect(s.getItem("nb.alice.messages")).toBeNull();
  });

  it("🔴 不得動到別的身分", () => {
    clearStorageNamespace("alice", s);
    expect(s.getItem("nb.bob.fsState")).toBe("別人的");
  });

  it("🔴 不得動到全域／裝置級鍵（前綴相同但不屬於任何身分）", () => {
    // `nb.profiles` 與 `nb.deviceId` 沒有 `<namespace>.` 那一段，前綴比對必須夠精確。
    clearStorageNamespace("alice", s);
    expect(s.getItem("nb.profiles")).toBe("全域登錄");
    expect(s.getItem("nb.deviceId")).toBe("裝置級");
  });

  it("空 namespace＝不做事（舊的單一身分用無前綴鍵，誤清會清掉全部）", () => {
    clearStorageNamespace("", s);
    expect(s.getItem("nb.alice.fsState")).not.toBeNull();
    expect(s.getItem("nb.profiles")).toBe("全域登錄");
  });

  it("刪除過程中索引位移不得漏掉鍵（先收集再刪）", () => {
    for (let i = 0; i < 20; i++) s.setItem(`nb.carol.k${i}`, "x");
    clearStorageNamespace("carol", s);
    for (let i = 0; i < 20; i++) expect(s.getItem(`nb.carol.k${i}`)).toBeNull();
  });
});
