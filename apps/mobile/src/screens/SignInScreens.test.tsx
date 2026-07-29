import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PairBundle } from "@cinderous/engine";
import { NsecSignInScreen } from "./NsecSignInScreen.js";
import { PairImportScreen } from "./PairImportScreen.js";

// 畫面互動（輸入/按鈕）在 renderToStaticMarkup 下不會執行，登入邏輯由 auth.test.ts 把關；
// 此處確保兩畫面在深色＋自訂主色下靜態渲染出標題/入口、且吃 @cinderous/theme（ADR-0080/0081）。
describe("行動端登入畫面（ADR-0081）", () => {
  it("NsecSignInScreen（A）：渲染標題與切換配對入口（en）", () => {
    const html = renderToStaticMarkup(
      <NsecSignInScreen
        onSignIn={() => {}}
        onUsePairing={() => {}}
        locale="en"
        theme="dark"
        accent="#2f6cd6"
        accent2="#e2632b"
      />,
    );
    expect(html).toContain("Sign in to Cinderous"); // mobileSignIn_title（ADR-0277）
    expect(html).toContain("Import from old device instead"); // mobileSignIn_toPair
  });

  // ADR-0277：初次登入只要「顯示名稱＋密碼」。過去這裡是 nsec 欄且標題寫「用私鑰登入」，
  // 意謂手機使用者必須先有桌面版才進得來——「手機是第一個裝置」的人根本沒有入口。
  it("🔴 預設不顯示 nsec 欄：初始只要名稱（＋記住我密碼），私鑰登入降為次要連結", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} canRemember locale="zh-Hant" />);
    expect(html).not.toContain('data-testid="nsec-input"');
    expect(html).toContain("顯示名稱"); // mobileSignIn_nameLabel
    expect(html).toContain('data-testid="remember-password"'); // 密碼欄（ADR-0117）
    expect(html).toContain("建立新身分"); // signIn_createButton＝主要動作
    expect(html).toContain('data-testid="use-nsec"'); // 次要路徑仍在，只是收合
  });

  it("初始畫面不出現任何「示範／貼上 nsec」字樣（ADR-0277：不讓使用者看到開發用詞）", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} canRemember locale="zh-Hant" />);
    expect(html).not.toContain("示範");
    expect(html).not.toContain("nsec1");
  });

  it("NsecSignInScreen：提供 onJoinOrg → 顯示「可貼入職邀請碼」提示（入職入口，ADR-0176）", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} onJoinOrg={() => {}} locale="zh-Hant" />);
    expect(html).toContain("邀請碼"); // addId_invite 提示
  });

  it("NsecSignInScreen：未提供 onJoinOrg → 無入職提示（純一般登入）", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} locale="zh-Hant" />);
    expect(html).not.toContain("邀請碼");
  });

  it("NsecSignInScreen：提供 onCreateCompany → 顯示「建立公司」入口（ADR-0178）", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} onCreateCompany={() => {}} locale="zh-Hant" />);
    expect(html).toContain('data-testid="create-company"');
    expect(html).toContain("建立公司");
  });

  it("PairImportScreen（B）：渲染標題與切換金鑰入口（zh）", () => {
    const html = renderToStaticMarkup(
      <PairImportScreen
        onPair={() => Promise.resolve({} as PairBundle)}
        onImport={() => {}}
        onUseNsec={() => {}}
        locale="zh-Hant"
        theme="light"
      />,
    );
    expect(html).toContain("從舊裝置匯入"); // mobilePair_title
    expect(html).toContain("改用私鑰登入"); // mobilePair_toNsec
  });
});
