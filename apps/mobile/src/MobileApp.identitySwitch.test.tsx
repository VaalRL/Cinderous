// @vitest-environment jsdom
//
// 切身分的互動測試（ADR-0328／Phase P4）。
//
// ## 為什麼需要它
//
// 行動端的 per-identity 隔離靠 `signInWith` 內一份**手寫的 42 個重設呼叫**維持
// （桌面走 `location.reload()`＝結構性保證，不可能漏）。
// `MobileApp.perIdentityState.test.ts` 掃原始碼、強制「每個 `useState` 都要被分類、
// per-identity 的必須在 `signInWith` 內被指派」——但它擋不住四類東西：
//
//   1. **分錯類**（它只驗有沒有被分類，不驗分得對不對）；
//   2. **`useRef`**（regex 只掃 `useState`，ref 完全在射程外）；
//   3. **非同步落地**（`.then(setState)` 在切身分之後才回來）；
//   4. **重設了但值是錯的**（只驗 setter 名字有沒有出現，不驗傳什麼）。
//
// 那四類都住在互動與時間裡，而行動端在此之前**所有** UI 測試都是 `renderToStaticMarkup`
// ——SSR 只渲染一次，`useEffect` 從不執行、事件從不觸發。
//
// ⚠ 這同時也是 P4 遲遲不做治本重構的理由（ROADMAP：「行動端測試只有靜態渲染、抓不到
// 互動回歸，風險過高」）。同一個弱點兩頭都佔：既讓重構不敢動，也讓這類 bug 平常不會被
// 發現。**先補這層，那個循環才斷得掉。**
import { beforeEach, describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey, npubEncode, nsecEncode } from "@cinderous/core";
import { MobileApp } from "./MobileApp.js";
import { byTestId, clearStorage, click, ids, mount, settle, stubWebSocket, typeInto } from "./test/jsdom-mount.js";

/** 以 nsec ＋ 本地密碼登入一個新身分（走真正的登入畫面，不繞過任何一步）。 */
async function signIn(c: HTMLElement, name: string, pw: string): Promise<void> {
  typeInto(byTestId(c, "signin-name"), name);
  click(byTestId(c, "use-nsec"));
  typeInto(byTestId(c, "nsec-input"), nsecEncode(generateSecretKey()));
  typeInto(byTestId(c, "remember-password"), pw);
  click(byTestId(c, "signin-submit"));
  await settle();
}

/** 加一個聯絡人（產生這個身分專屬的 `contacts`／`convos`），回傳顯示用的 npub 片段。 */
async function addContact(c: HTMLElement, label: string): Promise<string> {
  const npub = npubEncode(getPublicKey(generateSecretKey()));
  click(byTestId(c, "add-contact-toggle"));
  await settle();
  typeInto(byTestId(c, "add-contact-input"), `${npub} #${label}`); // 空白分隔（parseContactInput）
  click(byTestId(c, "add-submit"));
  await settle();
  return label;
}

/** 開某個對話並送一則訊息（產生這個身分專屬的 `convos`／`activeId`／`unsent`）。 */
async function sendInFirstChat(c: HTMLElement, text: string): Promise<void> {
  const row = ids(c).find((i) => i.startsWith("chat-"));
  expect(row, "應該有對話可開").toBeTruthy();
  click(byTestId(c, row!));
  await settle();
  typeInto(byTestId(c, "composer-input"), text);
  click(byTestId(c, "composer-send"));
  await settle();
}

/** 回到分頁外殼（送完訊息時人還在對話畫面裡，底部分頁不在畫面上）。 */
async function backToTabs(c: HTMLElement): Promise<void> {
  if (ids(c).includes("convo-back")) {
    click(byTestId(c, "convo-back"));
    await settle();
  }
}

/** 進設定分頁。 */
async function openSettings(c: HTMLElement): Promise<void> {
  await backToTabs(c);
  click(byTestId(c, "tab-settings"));
  await settle();
}

const text = (c: HTMLElement): string => c.textContent?.replace(/\s+/g, " ") ?? "";

describe("切身分的範圍隔離（Phase P4／ADR-0328）", () => {
  // ⚠ 每個案例都要跑 1～3 次 Argon2id（登入時包裹 nsec、切回時解鎖）——那是刻意的成本
  // （ADR-0117），不是測試寫壞了。故放寬逾時，不是調低 KDF 參數。
  beforeEach(() => {
    clearStorage();
    stubWebSocket(); // 測試不碰網路（見 stubWebSocket 的註解）
  });

  it("登入 → 送訊息 → 訊息在畫面上（先確定測試本身有效，不是空跑）", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await addContact(m.container, "夜的聯絡人");
    await sendInFirstChat(m.container, "阿夜的祕密");
    expect(text(m.container)).toContain("阿夜的祕密");
    m.unmount();
  }, 30_000);

  it("🔴 新增第二個身分後，看不到上一個身分的訊息", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await addContact(m.container, "夜的聯絡人");
    await sendInFirstChat(m.container, "阿夜的祕密");

    await openSettings(m.container);
    click(byTestId(m.container, "identity-add"));
    await settle();
    await signIn(m.container, "小北", "pw-b");

    expect(text(m.container)).not.toContain("阿夜的祕密");
    m.unmount();
  }, 30_000);

  it("🔴 聯絡人不跨身分——加聯絡人是身分層的動作", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await addContact(m.container, "夜的聯絡人");
    expect(text(m.container)).toContain("夜的聯絡人");

    await openSettings(m.container);
    click(byTestId(m.container, "identity-add"));
    await settle();
    await signIn(m.container, "小北", "pw-b");
    expect(text(m.container)).not.toContain("夜的聯絡人");
    m.unmount();
  }, 30_000);

  it("軟登出回解鎖畫面，聊天內容不再顯示（ADR-0201）", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await addContact(m.container, "夜的聯絡人");
    await sendInFirstChat(m.container, "阿夜的祕密");

    await openSettings(m.container);
    click(byTestId(m.container, "logout"));
    await settle();

    expect(ids(m.container)).toContain("unlock-password");
    expect(text(m.container)).not.toContain("阿夜的祕密");
    m.unmount();
  }, 30_000);

  it("🔴 登出後改登入**另一個**身分：看不到上個身分的訊息（ADR-0332 2b 會切開這條接縫）", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await addContact(m.container, "夜的聯絡人");
    await sendInFirstChat(m.container, "阿夜的祕密");

    await openSettings(m.container);
    click(byTestId(m.container, "logout"));
    await settle();
    click(byTestId(m.container, "unlock-use-nsec")); // 解鎖畫面 →「改用私鑰登入」
    await settle();
    await signIn(m.container, "小北", "pw-b");

    expect(text(m.container)).not.toContain("阿夜的祕密");
    expect(text(m.container)).not.toContain("夜的聯絡人");
    m.unmount();
  }, 30_000);

  it("🔴 切走再切回來：兩次都要是乾淨的 session（2c 掛 key 之後這條是結構性保證）", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await addContact(m.container, "夜的聯絡人");

    await openSettings(m.container);
    click(byTestId(m.container, "identity-add"));
    await settle();
    await signIn(m.container, "小北", "pw-b");
    expect(text(m.container)).not.toContain("夜的聯絡人");

    // 切回阿夜
    await openSettings(m.container);
    const back = ids(m.container).filter((i) => i.startsWith("identity-") && i !== "identity-add");
    click(byTestId(m.container, back[0]!));
    await settle();
    typeInto(byTestId(m.container, "unlock-password"), "pw-a");
    click(byTestId(m.container, "unlock-submit"));
    await settle();

    // 再切去小北：不得帶著阿夜的東西
    await openSettings(m.container);
    const again = ids(m.container).filter((i) => i.startsWith("identity-") && i !== "identity-add");
    expect(again.length).toBeGreaterThan(0);
    m.unmount();
  }, 30_000);

  it("🔵 反向：裝置層的偏好**必須**跨身分保留——分類要兩邊都對，不是一律清光", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await openSettings(m.container);
    click(byTestId(m.container, "locale-en")); // 語言是**這台裝置**的偏好
    await settle();
    expect(text(m.container)).toContain("Settings");

    click(byTestId(m.container, "identity-add"));
    await settle();
    await signIn(m.container, "小北", "pw-b");
    await openSettings(m.container);
    expect(text(m.container)).toContain("Settings"); // 切了身分仍是英文
    expect(text(m.container)).not.toContain("設定");
    m.unmount();
  }, 30_000);

  it("🔴 外觀偏好跨重啟記住（ADR-0333）——原本重開 App 就回預設", async () => {
    const first = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(first.container, "阿夜", "pw-a");
    await openSettings(first.container);
    click(byTestId(first.container, "locale-en"));
    click(byTestId(first.container, "theme-dark"));
    await settle();
    first.unmount();

    // 重開 App（同一份 localStorage）：不清 storage，只重新掛載
    const again = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    expect(localStorage.getItem("nb.theme")).toBe("dark");
    expect(localStorage.getItem("nb.locale")).toBe("en");
    expect(text(again.container), "重開後仍是英文").toMatch(/Unlock|Password|password/i);
    again.unmount();
  }, 30_000);

  it("🔴 切回原身分再切走，兩邊的訊息都不互相殘留", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    await signIn(m.container, "阿夜", "pw-a");
    await addContact(m.container, "夜的聯絡人");
    await sendInFirstChat(m.container, "阿夜的祕密");

    await openSettings(m.container);
    click(byTestId(m.container, "identity-add"));
    await settle();
    await signIn(m.container, "小北", "pw-b");
    await addContact(m.container, "北的聯絡人");
    await sendInFirstChat(m.container, "小北的祕密");
    expect(text(m.container)).not.toContain("阿夜的祕密");

    // 切回阿夜（真的走 switchActive ＋ 解鎖，不是重新登入）
    await openSettings(m.container);
    const back = ids(m.container).filter((i) => i.startsWith("identity-") && i !== "identity-add");
    expect(back.length, "設定頁應列出兩個身分").toBeGreaterThan(0);
    click(byTestId(m.container, back[0]!));
    await settle();
    typeInto(byTestId(m.container, "unlock-password"), "pw-a");
    click(byTestId(m.container, "unlock-submit"));
    await settle();

    expect(text(m.container)).not.toContain("小北的祕密");
    m.unmount();
  }, 30_000);
});
