// @vitest-environment jsdom
//
// 企業流程的互動測試（ADR-0332 §4.1 續）。
//
// ## 為什麼特地補這兩條
//
// 階段 2b 要把登入的控制流反轉（外殼命令式 `signInWith` → 子元件掛載時接線），而**每一條登入
// 路徑都經過 `signInWith`**：一般登入／解鎖／切身分／**入職邀請碼**／**建立公司**／離職接管／配對匯入。
//
// 前三條已有覆蓋（`MobileApp.identitySwitch.test.tsx`）。這裡補企業那兩條——它們是唯二
// **會帶 `opts` 進 `signInWith`** 的可驅動路徑（`joinInvite` 與 `overrideOrg`），
// 而 `opts` 正是反轉後最容易掉東西的地方：它決定連哪座 relay、帶不帶入職權杖、是不是企業主。
//
// ⚠ 仍未覆蓋（見 ADR-0332 §4.2）：**離職接管**需要先有託管事件、**配對匯入**需要真的 WebRTC。
import { beforeEach, describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey, makeOrgInvite, nsecEncode } from "@cinderous/core";
import { MobileApp } from "./MobileApp.js";
import { byTestId, clearStorage, click, ids, mount, settle, stubWebSocket, typeInto } from "./test/jsdom-mount.js";

const text = (c: HTMLElement): string => c.textContent?.replace(/\s+/g, " ") ?? "";

describe("企業登入路徑（ADR-0332 §4.1）", () => {
  beforeEach(() => {
    clearStorage();
    stubWebSocket();
  });

  it("🔴 建立公司：進得了組織名冊，且身分是企業主（`overrideOrg` 這條路）", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    typeInto(byTestId(m.container, "signin-name"), "夜企業");
    typeInto(byTestId(m.container, "remember-password"), "pw-owner");
    click(byTestId(m.container, "create-company"));
    await settle();

    // `createCompany` 在 signInWith 之後把畫面覆寫成 roster——反轉之後這個順序最容易掉。
    expect(text(m.container), "應落在組織名冊畫面").toMatch(/名冊|Roster|組織/);
    expect(ids(m.container)).not.toContain("signin-name"); // 真的離開登入畫面了
    m.unmount();
  }, 30_000);

  it("🔴 邀請碼入職：貼碼後切到入職模式，登入後鎖公司座（`joinInvite` 這條路）", async () => {
    const invite = makeOrgInvite({
      relayUrl: "wss://company.invalid",
      adminPubkey: getPublicKey(generateSecretKey()),
      token: "tok-abc",
    });
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);

    // 邀請碼貼在**顯示名稱欄**（`parseOrgInvite(name)`）——貼進去畫面就換成入職模式。
    typeInto(byTestId(m.container, "signin-name"), invite);
    await settle();
    expect(ids(m.container), "貼碼後應出現入職欄位").toContain("join-name");

    typeInto(byTestId(m.container, "join-name"), "新同事");
    typeInto(byTestId(m.container, "remember-password"), "pw-join");
    click(byTestId(m.container, "join-org"));
    await settle();

    expect(ids(m.container)).not.toContain("signin-name"); // 已登入
    expect(ids(m.container)).toContain("chats-search"); // 落在主畫面
    m.unmount();
  }, 30_000);

  it("🔴 企業主的名冊入口不得跟著切到個人身分（先驗有、再驗沒有——否則這條是空跑）", async () => {
    const m = mount(<MobileApp relayUrl="wss://relay.invalid" />);
    typeInto(byTestId(m.container, "signin-name"), "夜企業");
    typeInto(byTestId(m.container, "remember-password"), "pw-owner");
    click(byTestId(m.container, "create-company"));
    await settle();

    // 企業主的設定頁**有**組織名冊入口
    click(byTestId(m.container, "roster-back"));
    await settle();
    click(byTestId(m.container, "tab-settings"));
    await settle();
    expect(ids(m.container), "企業主應看得到名冊入口").toContain("open-roster");

    // 換到一般個人身分
    click(byTestId(m.container, "identity-add"));
    await settle();
    typeInto(byTestId(m.container, "signin-name"), "私人");
    click(byTestId(m.container, "use-nsec"));
    typeInto(byTestId(m.container, "nsec-input"), nsecEncode(generateSecretKey()));
    typeInto(byTestId(m.container, "remember-password"), "pw-personal");
    click(byTestId(m.container, "signin-submit"));
    await settle();
    click(byTestId(m.container, "tab-settings"));
    await settle();

    expect(ids(m.container), "個人身分不該看到公司名冊入口").not.toContain("open-roster");
    m.unmount();
  }, 30_000);
});
