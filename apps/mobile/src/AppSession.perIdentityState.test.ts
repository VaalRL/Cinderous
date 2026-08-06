// per-identity state 的範圍隔離守衛（P4／ADR-0294 §2）。
//
// ## 為什麼是「掃原始碼」這種怪測試
//
// 桌面換身分走 `location.reload()`——**結構性保證**，不可能漏。行動端是**就地切換**，
// 靠 `signInWith` 裡一份手寫清單把 per-identity state 歸零。ADR-0294 §2 抓到三個漏網
// （`archived`／`purged`／`calDraft`），其中 `archived` 是歷史入口的閘門：兩個身分若
// 共用同一個 pubkey 鍵，切過去就看得到**上個身分的幽靈歷史入口**。
//
// ADR-0294 建議的治本解是「把 per-identity state 關進以身分為 `key` 的子元件」，
// 那樣清單可以整個刪掉。**尚未做**（見 ROADMAP Phase P 的 P4；ADR-0331 的階段 1 正在
// 按功能簇抽 hook 為它鋪路）。在那之前，這支測試提供「新增 state 天然安全」的**下限**：
//
//   1. 任何新 `useState` 都必須先被**分類**（per-identity 或裝置/外殼層），否則本測試紅；
//   2. 分到 per-identity 的，必須在 `signInWith` 內被指派，否則本測試紅。
//
// 它擋不住「分錯類」（那需要人看），但擋得住「忘了想」——而忘了想正是這三個漏網的成因。
import { readFileSync } from "node:fs";
import { IDENTITY_CLUSTERS } from "./test/identity-clusters.js";
import { describe, expect, it } from "vitest";
import { APP_SESSION_FILE } from "./test/app-session-path.js";

const SRC = readFileSync(new URL(`./${APP_SESSION_FILE}`, import.meta.url), "utf8");

/**
 * 隨身分而變的 session 資料：切身分必須歸零，否則上個身分的東西會漏過來。
 * 含「登入時從持久化偏好重新載入」的那些（`selfStatus` 等）——它們同樣不能沿用前一個身分的值。
 */
const PER_IDENTITY = new Set<string>([
  // ⚠ **全部 41 個 per-identity state 都已於 ADR-0331 抽進功能簇**（見下方「抽出去的功能簇」）。
  // 這個集合現在是空的——那不是「不管了」，是責任整批移到簇的 `reset()` 上，由下方規則檢查。
  // 若日後又在 MobileApp 直接新增 per-identity 的 `useState`，先問它該進哪一簇。
  // ⚠ 身分本體（pubkey／name／npub／nsec）與上線狀態（隱身／狀態／狀態文字／正在聽）
  // 那 8 個已於 ADR-0331 抽進 `use-self-session.ts`，改由下方的「功能簇」規則納管。
  // ⚠ 企業那 8 個（ADR-0172／0176／0178／0311）已於 ADR-0331 抽進 `use-org-session.ts`，
  // 改由下方的「功能簇」規則納管——不是不管了。
  // ⚠ 通話那 5 個已於 ADR-0331 抽進 `use-call-session.ts`；`connState` 則併入
  // `use-self-session.ts`（「看起來在線」與「實際上連著嗎」是同一問題的兩面）。
  // ⚠ 設定頁的身分層開關那 5 個（FS／解封失敗計數／入群閘門／裝置／雲端備份，
  // ADR-0245／0316／0317／0321／0327）已於 ADR-0331 抽進 `use-identity-settings.ts`，
  // 改由下方的「功能簇」規則納管——不是不管了。
]);

/**
 * 裝置或外殼層：**刻意不隨身分歸零**。
 * 外觀與語言是這台裝置的偏好；`profiles`／`screen`／`tab` 是外殼導航；
 * `notify`／`fgOn`／`chatBg` 是裝置層開關；`pendingSwitch`／`pairPhase` 是流程狀態。
 */
const DEVICE_OR_SHELL = new Set([
  // ⚠ `profiles`／`theme`／`locale`／`accent` 已於 ADR-0332 2b 搬到外殼 `MobileApp.tsx`
  // ——它們必須**比一個 session 活得久**（切身分時 profiles 不能消失、外觀不該重設）。
  // 留在這裡的是 session 內的外殼狀態。
  "screen", "pendingSwitch", "tab",
  "fgOn", "notify", "notifyHide", "chatBg", "pairPhase",
  // ⚠ 這兩個讀的是**全域** localStorage 鍵（`nb.readReceipts`／保留上限），不帶 pubkey
  // ⇒ 現行語意是裝置層，切身分不重載。已讀回條是「這台要不要送回條」、保留上限是「這台留多少」，
  // 裝置層語意說得過去。
  // 🔵 `cloudSync` 原本也在這裡，**已於 ADR-0327 移到 per-identity**——它和這兩個不同類：
  // 決定的是「這個身分的資料要不要離開裝置」，而桌面一向就是身分層。
  "retentionCap", "readReceipts",
  // ADR-0336 §4：「**這台**的通話要不要經過第三方」——與身分無關，同 readReceipts 那一類。
  "allowPublicTurn",
  // ADR-0339：這台**硬體上**有幾個鏡頭。與身分完全無關（換人不會長出第二個鏡頭）。
  // 之所以住在 AppSession 而非外殼，是因為 `enumerateDevices` 只在通話中（相機權限已給）
  // 才給得出有意義的資料 ⇒ 依附通話生命週期查詢，重掛後重查一次即可，無殘留風險。
  "cameraCount",
]);

/** 抽出所有 `const [x, setX] = useState` 的名稱與其 setter。 */
function states(): { name: string; setter: string }[] {
  const re = /const \[(\w+),\s*(\w+)\] = useState/g;
  const out: { name: string; setter: string }[] = [];
  for (let m = re.exec(SRC); m; m = re.exec(SRC)) out.push({ name: m[1]!, setter: m[2]! });
  return out;
}

/** `signInWith` 的函式本體（從宣告到 per-identity 重設區結束後的 `backend.start(`）。 */
function signInWithBody(): string {
  const from = SRC.indexOf("const signInWith = (");
  expect(from).toBeGreaterThan(-1);
  const to = SRC.indexOf("backend.start({", from);
  expect(to).toBeGreaterThan(from);
  return SRC.slice(from, to);
}

describe("per-identity state 範圍隔離（P4／ADR-0294 §2）", () => {
  const all = states();

  it("掃得到 state（避免 regex 壞掉時測試假性通過）", () => {
    // ⚠ 門檻算的是 **MobileApp ＋ 所有已抽出的簇**。只數 MobileApp 的話，每抽一簇就要調低一次
    // 門檻，而「因為重構所以調低防呆門檻」與「regex 壞了」在數字上看起來一模一樣。
    const inClusters = IDENTITY_CLUSTERS.reduce((n, c) => {
      const hook = readFileSync(new URL(`./${c.file}`, import.meta.url), "utf8");
      return n + [...hook.matchAll(/const \[\w+,\s*\w+\] = useState/g)].length;
    }, 0);
    expect(all.length + inClusters).toBeGreaterThan(50);
  });

  it("🔴 每個 state 都必須被分類——新增而未分類即失敗（這就是「忘了想」的擋板）", () => {
    const unclassified = all.filter((s) => !PER_IDENTITY.has(s.name) && !DEVICE_OR_SHELL.has(s.name));
    expect(unclassified.map((s) => s.name)).toEqual([]);
  });

  it("🔴 每個 per-identity state 都必須在 `signInWith` 內被指派", () => {
    const body = signInWithBody();
    const missing = all
      .filter((s) => PER_IDENTITY.has(s.name))
      .filter((s) => !body.includes(`${s.setter}(`))
      .map((s) => s.name);
    expect(missing).toEqual([]);
  });

  it("ADR-0294 §2 抓到的三個漏網：現在是**結構性**不可能（回歸隨階段演進，但沒有被刪）", () => {
    // 這條回歸的斷言對象已經換過三次，因為那三個 state 一路搬家：
    //   ①ADR-0294：檢查 `signInWith` 內有 `setArchived(`／`setPurged(`／`setCalDraft(`
    //   ②ADR-0331：搬進功能簇 → 改檢查 `threads.reset(`／`cal.reset(`
    //   ③ADR-0332 2c：`key` 重掛取代手寫歸零 → `reset()` 已刪，改檢查**它們住在會被重掛的地方**
    // 🔴 每一次都是換對象，不是刪掉——一條回歸一旦被刪，那個 bug 就等於沒發生過。
    const threads = readFileSync(new URL("./use-thread-session.ts", import.meta.url), "utf8");
    const cal = readFileSync(new URL("./use-calendar-session.ts", import.meta.url), "utf8");
    expect(threads, "漏網①archived 必須是簇內的 state").toMatch(/const \[archived,/);
    expect(threads, "漏網②purged 必須是簇內的 state").toMatch(/const \[purged,/);
    expect(cal, "漏網③calDraft 必須是簇內的 state").toMatch(/const \[draft,/);
    // 而簇在 session 聚合物裡、聚合物在被 key 掛住的 AppSession 裡（見「結構性保證」那組）。
    const agg = readFileSync(new URL("./use-identity-session.ts", import.meta.url), "utf8");
    expect(agg).toContain("threads:");
    expect(agg).toContain("cal:");
  });

  describe("抽出去的功能簇（ADR-0331／0332）", () => {
    // 🔴 把 state 搬進 hook，它就從上面的 `useState` 掃描裡消失了。
    // 若不在這裡接手，「重構」就等於「把東西藏到守衛看不到的地方」。
    //
    // 🔵 ADR-0332 2c 起，「切身分要歸零」**不再由這裡檢查**——那條規則原本要求每個簇提供
    // `reset()` 且在 `signInWith` 內被呼叫。現在 `AppSession` 掛了 `key`，重掛即歸零，
    // 那些 `reset()` 已隨之刪除（留著就是沒人呼叫的死程式碼）。
    // 取而代之的是下方「結構性保證」那條：**外殼必須以作用中 session 當 key**。
    it("已登記至少一簇（避免登記表空著而規則空轉）", () => {
      expect(IDENTITY_CLUSTERS.length).toBeGreaterThan(0);
    });

    for (const c of IDENTITY_CLUSTERS) {
      it(`${c.file}：簇內的 state 不得再出現在 MobileApp（否則就是搬了一半）`, () => {
        const hook = readFileSync(new URL(`./${c.file}`, import.meta.url), "utf8");
        const setters = [...hook.matchAll(/const \[\w+,\s*(\w+)\] = useState/g)].map((m) => m[1]!);
        expect(setters.length).toBeGreaterThan(0);
        // ⚠ 要用字界比對：`org.setTitle(` 含有 `setTitle(` 但那是**經過 hook 的**呼叫，不是殘留。
        const leaked = setters.filter((x) => new RegExp(String.raw`(?<![.\w])${x}\(`).test(SRC));
        expect(leaked).toEqual([]);
      });
    }
  });

  it("分類表沒有幽靈條目（列了但原始碼裡不存在 → 表過期了）", () => {
    const names = new Set(all.map((s) => s.name));
    const ghosts = [...PER_IDENTITY, ...DEVICE_OR_SHELL].filter((n) => !names.has(n));
    expect(ghosts).toEqual([]);
  });

  describe("🔴 結構性保證（ADR-0332 2c）", () => {
    const shell = readFileSync(new URL("./MobileApp.tsx", import.meta.url), "utf8");

    it("外殼必須以**作用中 session** 當 `key` 渲染 AppSession", () => {
      // 這一行就是 Phase P4 的全部保證。沒有它，下面所有的分類與登記都只是紀律。
      expect(shell, "AppSession 必須掛 key").toMatch(/key=\{[^}]*active/);
      expect(shell, "key 必須含身分（換人要重掛）").toMatch(/active\.session\.identity\.pubkey/);
      expect(shell, "key 必須含世代（同一人重新登入也算新 session）").toMatch(/active\.gen/);
    });

    it("🔴 已無人呼叫的 `reset()` 不得留著（死程式碼會讓下一個人以為那條路還在用）", () => {
      for (const c of IDENTITY_CLUSTERS) {
        const hook = readFileSync(new URL(`./${c.file}`, import.meta.url), "utf8");
        if (!/reset\s*[:(]/.test(hook)) continue; // 沒有 reset 的簇（歸零全交給重掛）
        expect(SRC, `${c.file} 提供了 reset() 卻沒人呼叫`).toContain(`${c.holder}.reset(`);
      }
    });
  });

  it("🔴 外殼（MobileApp.tsx）只准放比一個 session 活得久的東西（ADR-0332 2b）", () => {
    const shell = readFileSync(new URL("./MobileApp.tsx", import.meta.url), "utf8");
    const inShell = [...shell.matchAll(/const \[(\w+),\s*\w+\] = useState/g)].map((m) => m[1]!);
    // `profiles` 要跨 session 存活；外觀/語言/視訊畫質是這台裝置的偏好；
    // `active` 是**指向 session 的指標**，本身不能住在 session 裡（否則切身分時誰記得要切去哪）。
    // 多出任何一個都要先問它憑什麼在這裡。
    //
    // `videoQuality`（ADR-0337）憑什麼：它是「**這台**的相機與網路」，與主題同類——
    // 切身分不該讓畫質跳掉，而它要同時餵給 CallScreen 與後端，兩者都在 session 內 ⇒ 由外殼往下傳。
    expect(inShell.sort()).toEqual(["accent", "active", "locale", "profiles", "theme", "videoQuality"]);
  });
});
