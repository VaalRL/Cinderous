// 身分 session 的聚合（ADR-0332 階段 2a）。
//
// 這支測試守的是**聚合物與登記表不得漂開**：功能簇的守衛（perIdentityState／asyncEpoch／
// refScope）都以 `IDENTITY_CLUSTERS` 為準，而 UI 拿到的是 `IdentitySession`。
// 兩邊若對不上，就會出現「登記了但沒人用」或「用了但沒被守衛看著」的簇。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDENTITY_CLUSTERS } from "./test/identity-clusters.js";

const SRC = readFileSync(new URL("./use-identity-session.ts", import.meta.url), "utf8");

describe("身分 session 聚合（ADR-0332）", () => {
  it("🔴 每一個已登記的簇都在聚合物裡（漏一個＝那個簇不會隨 `key` 重掛）", () => {
    const missing = IDENTITY_CLUSTERS.filter((c) => !SRC.includes(`${c.holder}:`));
    expect(missing.map((c) => c.file), "階段 2c 掛 key 時，不在聚合物裡的簇不會被重設").toEqual([]);
  });

  it("🔴 聚合物裡沒有未登記的簇（用了但沒被守衛看著）", () => {
    const inAggregate = [...SRC.matchAll(/^\s{4}(\w+): use\w+\(\),$/gm)].map((m) => m[1]!);
    expect(inAggregate.length).toBeGreaterThan(0);
    const unregistered = inAggregate.filter((h) => !IDENTITY_CLUSTERS.some((c) => c.holder === h));
    expect(unregistered, "把它加進 test/identity-clusters.ts").toEqual([]);
  });

  it("🔴 刻意沒有 `resetAll()`——各簇的 reset 需要各自不同的種子（ADR-0331 §7）", () => {
    // 只看程式碼：檔頭註解**寫著**為什麼不提供它，那不算違規。
    const code = SRC.split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join(" ");
    expect(code).not.toMatch(/resetAll/);
  });
});
