// `useRef` 的範圍隔離（ADR-0330／Phase P4）。
//
// ## 這是既有兩支守衛都看不到的東西
//
// - `MobileApp.perIdentityState.test.ts`（ADR-0294 §2）：只掃 `const [x, setX] = useState`。
// - `MobileApp.asyncEpoch.test.ts`（ADR-0329）：只掃 `.then(` 裡的 setter。
//
// **`useRef` 兩支都不在射程內。** 而 ref 一樣存得下 per-identity 的東西，而且它**不隨 render
// 重來**——切身分時沒人碰它，它就原封不動地跟著新身分走。
//
// ## 這支測試存在的直接理由
//
// 盤點 P4 時我用 `const .*Ref = useRef` 去數，得到 12 個、結論是「都安全」。
// 那個 regex **漏掉了三個不以 `Ref` 結尾的**（`pairDecision`／`statusBcTimer`／`typingTimer`）
// ——實際是 16 個。三個之中兩個剛好已經在 `signInWith` 裡被清掉，一個沒有。
//
// 🔴 **靠命名慣例做安全稽核，就是這樣漏的。** 這支測試不看名字，只看**每一個 `useRef` 有沒有
// 被分類**，形狀與另外兩支一致。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_SESSION_FILE } from "./test/app-session-path.js";
import { IDENTITY_CLUSTERS } from "./test/identity-clusters.js";

const SRC = readFileSync(new URL(`./${APP_SESSION_FILE}`, import.meta.url), "utf8");
const read = (f: string): string => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");

/**
 * **裝置／外殼層**的 ref：刻意不隨身分歸零，且必須說得出理由。
 * 這是唯一的例外清單——不在這裡、也不是鏡像、也沒在 `signInWith` 裡被碰，就是紅的。
 */
const DEVICE_OR_SHELL: Record<string, string> = {
  // 世代計數器本身（ADR-0329）：它就是「切了幾次身分」的紀錄，歸零等於失憶。
  epochRef: "世代計數器本身；歸零會讓已發出的非同步工作誤判成同一個身分",
};

/** 所有 `useRef` 的名稱。**不靠命名慣例**——這正是上次漏掉三個的原因。 */
function refs(): string[] {
  return [...SRC.matchAll(/const ([A-Za-z0-9_]+) = useRef/g)].map((m) => m[1]!);
}

/**
 * 「render 期鏡像」：在元件本體最外層（縮排兩格）直接由 state 指派，例如
 * `activeIdRef.current = activeId;`。這種 ref 每次 render 都跟著 state 走，
 * 而 state 已由 `perIdentityState.test.ts` 保證會重設 ⇒ 天然安全。
 */
function mirrors(): Set<string> {
  return new Set([...SRC.matchAll(/^ {2}([A-Za-z0-9_]+)\.current = /gm)].map((m) => m[1]!));
}

/**
 * 某段原始碼裡「沒被分類」的 ref。抽成函式是為了讓這支測試能**驗自己抓得到違規**——
 * 掃描器寫壞了同樣會全綠，那時它就只是個裝飾。
 */
export function unclassifiedIn(src: string, signInBody: string, allow: Record<string, string>): string[] {
  const names = [...src.matchAll(/const ([A-Za-z0-9_]+) = useRef/g)].map((m) => m[1]!);
  const mirror = new Set([...src.matchAll(/^ {2}([A-Za-z0-9_]+)\.current = /gm)].map((m) => m[1]!));
  return names.filter((n) => !mirror.has(n) && !signInBody.includes(`${n}.current`) && !(n in allow));
}

/** `signInWith` 的函式本體（到 `backend.start(` 為止，同 perIdentityState 的切法）。 */
function signInWithBody(): string {
  const from = SRC.indexOf("const signInWith = (");
  expect(from).toBeGreaterThan(-1);
  const to = SRC.indexOf("backend.start({", from);
  expect(to).toBeGreaterThan(from);
  return SRC.slice(from, to);
}

describe("useRef 的範圍隔離（ADR-0330）", () => {
  const all = refs();

  it("掃得到 ref，而且**不靠命名慣例**（上次就是這樣漏掉三個的）", () => {
    expect(all.length).toBeGreaterThan(10);
    // 真的有不以 `Ref` 結尾的——確認這支測試抓的比 `const .*Ref =` 多。
    expect(all.filter((n) => !n.endsWith("Ref")).length).toBeGreaterThan(0);
  });

  it("🔴 每個 `useRef` 都必須被分類：render 期鏡像／切身分時被清／明列為裝置層", () => {
    expect(
      unclassifiedIn(SRC, signInWithBody(), DEVICE_OR_SHELL),
      "在 `signInWith` 內清掉它，或加進 DEVICE_OR_SHELL 並寫下為什麼它不該歸零",
    ).toEqual([]);
  });

  it("🔴 這支測試抓得到違規（否則它綠著也不代表任何事）", () => {
    const naked = "  const lonelyRef = useRef(null);";
    expect(unclassifiedIn(naked, "", {})).toEqual(["lonelyRef"]);
    // 三條出路各自都能讓它變乾淨
    expect(unclassifiedIn(naked + "\n  lonelyRef.current = x;", "", {})).toEqual([]); // 鏡像
    expect(unclassifiedIn(naked, "lonelyRef.current = null;", {})).toEqual([]); // signInWith 內清掉
    expect(unclassifiedIn(naked, "", { lonelyRef: "理由寫在這裡" })).toEqual([]); // 明列為裝置層
  });

  it("例外清單每一筆都要有理由（空字串不算理由）", () => {
    expect(Object.entries(DEVICE_OR_SHELL).filter(([, why]) => why.trim().length < 10)).toEqual([]);
  });

  it("例外清單沒有幽靈條目（列了但原始碼裡不存在 → 表過期了）", () => {
    expect(Object.keys(DEVICE_OR_SHELL).filter((n) => !all.includes(n))).toEqual([]);
  });

  // 🔴 ref 也會隨著抽 hook 離開這支掃描器的射程（ADR-0331）——`typingTimer` 就是這樣跟著
  // 對話簇搬走的。同 `perIdentityState`／`asyncEpoch`：**抽出去不能變成繞過守衛的方法**。
  describe("抽出去的簇裡的 ref（ADR-0331）", () => {
    for (const c of IDENTITY_CLUSTERS) {
      const hook = read(c.file);
      const names = [...hook.matchAll(/const ([A-Za-z0-9_]+) = useRef/g)].map((m) => m[1]!);
      if (names.length === 0) continue;
      it(`🔴 ${c.file}：每個 ref 都要有明確的收尾（清計時器或歸 null）`, () => {
        const missing = names.filter(
          (n) => !hook.includes(`clearTimeout(${n}.current)`) && !hook.includes(`${n}.current = null`),
        );
        expect(missing, "簇裡的 ref 沒人收尾＝切身分後它跟著新身分走").toEqual([]);
      });
    }
  });

  it("🔴 計時器類的 ref 必須被清——不然上個身分排的計時器會在新身分身上響", () => {
    // ⚠ 跨 MobileApp ＋ 所有簇一起找：`typingTimer` 已隨對話簇搬走（ADR-0331），
    // 只看 MobileApp 會誤判成「不存在」——那正是這條規則要防的漏。
    const everywhere = [SRC, ...IDENTITY_CLUSTERS.map((c) => read(c.file))].join(" ");
    for (const timer of ["typingTimer", "statusBcTimer"]) {
      expect(everywhere, `${timer} 應該存在`).toContain(`const ${timer} = useRef`);
      expect(everywhere, `${timer} 沒有被清除`).toContain(`clearTimeout(${timer}.current)`);
    }
  });

  it("🔴 ADR-0330 上次漏掉的那三個確實仍被涵蓋（回歸）", () => {
    const body = signInWithBody();
    const mirror = mirrors();
    for (const n of ["pairDecision", "statusBcTimer"]) {
      expect(all).toContain(n);
      expect(mirror.has(n) || body.includes(`${n}.current`), `${n} 未被分類`).toBe(true);
    }
    // `typingTimer` 已搬進對話簇，改由上面那條「簇裡的 ref 要有收尾」涵蓋。
    const hook = read("use-thread-session.ts");
    expect(hook).toContain("const typingTimer = useRef");
    expect(hook).toContain("clearTimeout(typingTimer.current)");
  });
});
