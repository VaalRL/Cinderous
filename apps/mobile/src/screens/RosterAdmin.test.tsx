import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RosterAdminScreen } from "./RosterAdminScreen.js";

// 發布互動（解析成員、簽章名冊）在 SSR 下不跑——onPublish 契約與簽章由 engine/core 測試把關；
// 此處驗管理表單的結構：組織名/成員（預填管理者）/公司設定欄/發布鈕，以及邀請碼區的顯示條件。
const base = {
  selfNpub: "npub1owner",
  onPublish: () => [],
  onBack: () => {},
  locale: "zh-Hant" as const,
};

describe("行動端組織名冊管理（ADR-0178）", () => {
  it("渲染表單：組織名、成員（預填自己為管理者）、公司設定、發布鈕", () => {
    const html = renderToStaticMarkup(<RosterAdminScreen {...base} />);
    expect(html).toContain('data-testid="roster-org"');
    expect(html).toContain('data-testid="roster-members"');
    expect(html).toContain("管理者"); // 成員預填 "npub1owner 管理者"
    expect(html).toContain('data-testid="roster-welcome"');
    expect(html).toContain('data-testid="roster-work-start"');
    expect(html).toContain('data-testid="roster-publish"');
  });

  it("提供 invite → 顯示邀請碼與複製鈕（可貼給員工）", () => {
    const html = renderToStaticMarkup(
      <RosterAdminScreen {...base} invite={{ relayUrl: "wss://co.relay", adminPubkey: "a".repeat(64), token: "tok" }} />,
    );
    expect(html).toContain('data-testid="roster-invite"');
    expect(html).toContain('data-testid="roster-invite-copy"');
    expect(html).toContain("cinderinvite1"); // 邀請碼前綴
  });

  it("未提供 invite → 不顯示邀請碼區（尚無核准權杖/公司座）", () => {
    const html = renderToStaticMarkup(<RosterAdminScreen {...base} />);
    expect(html).not.toContain('data-testid="roster-invite"');
  });

  it("預填現行名冊（ADR-0157）：帶入組織名與成員，不必重打", () => {
    const html = renderToStaticMarkup(
      <RosterAdminScreen
        {...base}
        initial={{ org: "Acme", members: [{ pubkey: "b".repeat(64), name: "Bob" }], updatedAt: 1 }}
      />,
    );
    expect(html).toContain("Acme");
    expect(html).toContain("Bob");
  });

  it("公司儲存槽收檔提示（ADR-0179）：一律顯示「僅桌面版」文字提示", () => {
    const html = renderToStaticMarkup(<RosterAdminScreen {...base} />);
    expect(html).toContain('data-testid="vault-desktop-only"');
    expect(html).toContain("僅桌面版");
  });

  it("離職接管（ADR-0179）：有離職託管 → 顯示接管/刪除；無則不顯示", () => {
    const withOff = renderToStaticMarkup(
      <RosterAdminScreen {...base} offboarded={[{ pubkey: "m1", name: "Eve" }]} onTakeover={() => {}} onDeleteEscrow={() => {}} />,
    );
    expect(withOff).toContain('data-testid="takeover-m1"');
    expect(withOff).toContain('data-testid="delete-escrow-m1"');
    expect(withOff).toContain("Eve");
    const withoutOff = renderToStaticMarkup(<RosterAdminScreen {...base} />);
    expect(withoutOff).not.toContain('data-testid="takeover-');
  });
});
