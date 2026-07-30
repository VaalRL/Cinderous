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
// 那樣清單可以整個刪掉。那是 1588 行、51 個 `useState` 的元件重構——**尚未做**
// （見 ROADMAP Phase P 的 P4）。在那之前，這支測試提供「新增 state 天然安全」的**下限**：
//
//   1. 任何新 `useState` 都必須先被**分類**（per-identity 或裝置/外殼層），否則本測試紅；
//   2. 分到 per-identity 的，必須在 `signInWith` 內被指派，否則本測試紅。
//
// 它擋不住「分錯類」（那需要人看），但擋得住「忘了想」——而忘了想正是這三個漏網的成因。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./MobileApp.tsx", import.meta.url), "utf8");

/**
 * 隨身分而變的 session 資料：切身分必須歸零，否則上個身分的東西會漏過來。
 * 含「登入時從持久化偏好重新載入」的那些（`selfStatus` 等）——它們同樣不能沿用前一個身分的值。
 */
const PER_IDENTITY = new Set([
  // 通訊資料
  "contacts", "groups", "convos", "unread", "reactions", "unsent", "blocked", "requests", "calendar",
  // 檢視/互動狀態
  "archived", "purged", "calDraft", "activeId", "typingFrom",
  // 身分本身
  "selfPubkey", "selfName", "selfNpub", "selfNsec",
  // 隨身分載入的狀態
  "invisible", "selfStatus", "selfStatusMessage", "selfNowPlaying",
  // 企業脈絡（ADR-0172／0176／0178）
  "selfEnterprise", "selfAdmin", "selfOwner", "selfInviteToken", "escrowList", "slotQueue", "orgTitle",
  // 連線與通話（隨後端實例而生滅）
  "connState", "callPeer", "callState", "callMedia", "localStream", "remoteStream",
]);

/**
 * 裝置或外殼層：**刻意不隨身分歸零**。
 * 外觀與語言是這台裝置的偏好；`profiles`／`screen`／`tab` 是外殼導航；
 * `notify`／`fgOn`／`chatBg` 是裝置層開關；`pendingSwitch`／`pairPhase` 是流程狀態。
 */
const DEVICE_OR_SHELL = new Set([
  "profiles", "screen", "pendingSwitch", "tab", "theme", "locale", "accent",
  "fgOn", "notify", "notifyHide", "chatBg", "pairPhase",
  // ⚠ 這三個讀的是**全域** localStorage 鍵（`nb.readReceipts`／`nb.cloudSync`／保留上限），
  // 不帶 pubkey ⇒ 現行語意是裝置層，切身分不重載。
  // 這**可能本身就值得討論**（一個身分想開雲端備份、另一個不想，目前分不開），
  // 但那是設計題，不在 P4 範圍——P4 只保證「每個 state 都被分類過」。
  "retentionCap", "readReceipts", "cloudSync",
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
    expect(all.length).toBeGreaterThan(40);
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

  it("ADR-0294 §2 抓到的三個漏網確實補上了", () => {
    const body = signInWithBody();
    expect(body).toContain("setArchived(");
    expect(body).toContain("setPurged(");
    expect(body).toContain("setCalDraft(");
  });

  it("分類表沒有幽靈條目（列了但原始碼裡不存在 → 表過期了）", () => {
    const names = new Set(all.map((s) => s.name));
    const ghosts = [...PER_IDENTITY, ...DEVICE_OR_SHELL].filter((n) => !names.has(n));
    expect(ghosts).toEqual([]);
  });
});
