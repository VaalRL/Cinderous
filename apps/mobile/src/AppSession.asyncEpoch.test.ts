// 非同步落地必須綁世代（ADR-0329／Phase P4）。
//
// ## 為什麼又是「掃原始碼」這種怪測試
//
// 同 `MobileApp.perIdentityState.test.ts` 的理由，而且是同一個病的第二個面向：
//
//   - 那支擋的是「**切換那一瞬間**忘了重設某個 state」；
//   - 這支擋的是「**切換之前發出、切換之後才回來**的非同步工作把舊身分的東西寫進新身分」。
//
// 重設清單管不到已經在飛的 promise。而這條路徑**沒有任何自然的測試會踩到**——它要求
// 「非同步工作發出後、落地前」剛好切身分，jsdom 互動測試也難以穩定重現（ADR-0328 §5 已記）。
//
// 沒有測試就沒人會發現，而發現的方式會是使用者在新身分裡看到上個身分的東西。
//
// ⚠ 它擋不住「守衛寫了但比對邏輯寫反」（那需要人看），但擋得住**忘了加**——
// 而忘了加正是這類 bug 的成因。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_SESSION_FILE } from "./test/app-session-path.js";
import { IDENTITY_CLUSTERS } from "./test/identity-clusters.js";

const SRC = readFileSync(new URL(`./${APP_SESSION_FILE}`, import.meta.url), "utf8");

/**
 * 隨身分而變的 setter：這些若在非同步落地時被呼叫，就必須先確認還是同一個身分。
 * 與 `MobileApp.perIdentityState.test.ts` 的 `PER_IDENTITY` 同源——那邊列 state 名，這邊列 setter。
 */
const PER_IDENTITY_SETTERS: string[] = [
  // 🔵 **空的**：ADR-0331 階段 1 之後，所有 per-identity state 都在功能簇裡，
  // 寫入一律經 `<holder>.…`，由下方 `IDENTITY_CLUSTERS` 那條規則涵蓋。
  // 這個陣列保留著是因為「日後有人在 MobileApp 直接放回一個 per-identity setter」時，
  // 它是把那個 setter 納管的地方——**不是因為它現在還在用**。
];

/** 守衛的存在證明：`mark()` 取得、落地前呼叫。 */
const GUARD = /epochRef\.current\.mark\(\)|still\(\)/;

/**
 * 抽出每個 `.then(` 的回呼本體（以括號配對找結尾）。
 * 只認 `.then(`——`await` 之後的程式碼在同一個函式內，由該函式自己的守衛涵蓋。
 */
function thenBodies(src: string): { at: number; body: string }[] {
  const out: { at: number; body: string }[] = [];
  const re = /\.then\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push({ at: m.index, body: src.slice(m.index, i) });
  }
  return out;
}

/**
 * 某段程式碼裡「寫到 per-identity 狀態」的呼叫。
 *
 * 🔴 兩種都算，而第二種是 ADR-0331 抽 hook 之後**新增的漏洞來源**：
 *   1. `MobileApp` 自己的 setter（`setArchived(...)`）；
 *   2. **經由已抽出的簇**（`org.updateSlots(...)`）——setter 搬進 hook 之後，
 *      這支掃描器原本就看不到它了。不補這條，「抽 hook」會變成繞過守衛的方法。
 */
function settersIn(body: string): string[] {
  return [
    ...PER_IDENTITY_SETTERS.filter((s) => body.includes(`${s}(`)),
    ...IDENTITY_CLUSTERS.filter((c) => new RegExp(String.raw`(?<![.\w])${c.holder}\.\w`).test(body)).map(
      (c) => `${c.holder}.*`,
    ),
  ];
}

/** 某段原始碼裡「寫了 per-identity state 卻沒綁世代」的 `.then(`。 */
function unguarded(src: string): string[] {
  return thenBodies(src)
    .filter((b) => settersIn(b.body).length > 0 && !GUARD.test(b.body))
    .map((b) => `第 ${src.slice(0, b.at).split("\n").length} 行（寫了 ${settersIn(b.body).join("／")}）`);
}

describe("非同步落地綁身分世代（ADR-0329）", () => {
  const bodies = thenBodies(SRC);

  it("掃得到 `.then(`，而且其中真的有寫 per-identity 狀態的（避免規則空轉）", () => {
    expect(bodies.length).toBeGreaterThan(3);
    // 現在都走簇（`org.updateSlots` 之類），不再是裸 setter——但「真的有東西要守」這件事不變。
    expect(bodies.filter((b) => settersIn(b.body).length > 0).length).toBeGreaterThan(0);
  });

  it("🔴 這支測試抓得到違規（否則它綠著也不代表任何事）", () => {
    // ⚠ 用**簇**當例子，不用裸 setter——ADR-0331 之後 per-identity state 全在簇裡，
    // 拿一個已經不存在的 setter 當合成案例，這條自我檢查就會變成裝飾。
    const holder = IDENTITY_CLUSTERS[0]!.holder;
    expect(unguarded(`void thing().then((n) => ${holder}.reset(n));`)).toHaveLength(1);
    expect(
      unguarded(`const still = g.mark();\nvoid thing().then((n) => { if (!still()) return; ${holder}.reset(n); });`),
    ).toEqual([]);
  });

  it("裝置層的 setter 不受此限（例如 `setPairPhase`）——只要求會跨身分的那些", () => {
    expect(unguarded(`void pair().then((ok) => setPairPhase({ kind: "done" }));`)).toEqual([]);
    expect(SRC).toContain("setPairPhase("); // 真的有這樣一條，不是假設
  });

  it("🔴 經由已抽出的簇寫入也算（否則抽 hook 就成了繞過這條規則的方法）", () => {
    expect(unguarded(`void pickFile().then((f) => org.updateSlots(q => q));`)).toHaveLength(1);
    expect(
      unguarded(`const still = g.mark();
void pickFile().then((f) => { if (!still()) return; org.updateSlots(q => q); });`),
    ).toEqual([]);
  });

  it("🔴 任何在 `.then(` 內寫 per-identity state 的地方，都必須先確認還是同一個身分", () => {
    expect(
      unguarded(SRC),
      "在 `.then(` 前取 `const still = epochRef.current.mark()`，落地時 `if (!still()) return;`",
    ).toEqual([]);
  });

  it("🔴 `signInWith` 必須進新世代，而且要在停掉舊後端**之前**", () => {
    const from = SRC.indexOf("const signInWith = (");
    expect(from).toBeGreaterThan(-1);
    const bump = SRC.indexOf("epochRef.current.bump()", from);
    const stop = SRC.indexOf("backendRef.current?.stop()", from);
    expect(bump).toBeGreaterThan(-1);
    expect(bump).toBeLessThan(stop); // 晚了的話，停後端那一刻起的落地還會被當成同一個身分
  });

  it("ADR-0294 §2 的『幽靈歷史入口』那條路徑確實被守住了", () => {
    const at = SRC.indexOf("arch.chunkCount(");
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at - 200, at + 300)).toMatch(GUARD);
  });

  // 🔴 抽出去的簇不得成為繞過這條規則的方法（ADR-0331）。簇檔案裡沒有 `epochRef`
  // 可用，所以目前**一律不許有非同步落地**；哪天真的需要，正確做法是讓 hook 接受世代守衛
  // 當參數，並在這裡把規則改成「必須用它」——而不是把這條測試刪掉。
  for (const c of IDENTITY_CLUSTERS) {
    it(`🔴 ${c.file}：簇內不得有非同步落地（需要時請把世代守衛傳進去，別繞過）`, () => {
      const hook = readFileSync(new URL(`./${c.file}`, import.meta.url), "utf8");
      expect(thenBodies(hook).length, "簇內出現 `.then(`——見上方註解").toBe(0);
    });
  }

  it("setter 清單沒有幽靈條目（列了但原始碼裡不存在 → 表過期了）", () => {
    expect(PER_IDENTITY_SETTERS.filter((s) => !SRC.includes(`${s}(`))).toEqual([]);
  });

  it("🔴 已登記的簇都真的被 MobileApp 用著（登記表過期＝規則對著空氣執行）", () => {
    const stale = IDENTITY_CLUSTERS.filter((c) => !new RegExp(String.raw`(?<![.\w])${c.holder}\.`).test(SRC));
    expect(stale.map((c) => c.file)).toEqual([]);
  });
});
