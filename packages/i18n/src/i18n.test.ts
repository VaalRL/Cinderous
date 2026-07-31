import { describe, expect, it } from "vitest";
import { asLocale, catalog, createT, detectLocale, LOCALES, translate } from "./index.js";

describe("i18n", () => {
  it("每個語系都有完整且鍵一致的訊息", () => {
    const zhKeys = Object.keys(catalog["zh-Hant"]).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(catalog[locale]).sort()).toEqual(zhKeys);
    }
  });

  it("依語系翻譯", () => {
    expect(translate("zh-Hant", "status_online")).toBe("線上");
    expect(translate("en", "status_online")).toBe("Online");
  });

  it("插值參數", () => {
    expect(translate("en", "convo_typing", { name: "Bob" })).toBe("Bob is typing…");
    expect(translate("zh-Hant", "group_online", { count: 3 })).toBe("線上 (3)");
  });

  it("createT 綁定語系", () => {
    const t = createT("en");
    expect(t("signIn_button")).toBe("Sign in");
  });

  it("detectLocale 由偏好語言推測", () => {
    expect(detectLocale("zh-TW")).toBe("zh-Hant");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("fr")).toBe("zh-Hant"); // 回退預設
    expect(detectLocale(null)).toBe("zh-Hant");
  });

  it("asLocale 收斂無效值", () => {
    expect(asLocale("en")).toBe("en");
    expect(asLocale("xx")).toBe("zh-Hant");
    expect(asLocale(null)).toBe("zh-Hant");
  });
});

// ADR-0302 §4／ADR-0306：FS 相關文案的紅線。放在 i18n 層是刻意的——
// 桌面與行動端共用同一份文案，在這裡鎖住就同時保護兩端，不會有一端漂移。
describe("FS 文案紅線（ADR-0302 §4／ADR-0306 D1）", () => {
  it("🔴「不支援的機制」與「疑似降級」必須是不同的兩句話", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "fs_unsupportedWarning")).not.toBe(translate(locale, "fs_downgradeWarning"));
    }
  });

  it("🔴「不支援的機制」不得寫成安全警告——對方是升級了，不是被攻擊", () => {
    // 把「你該更新」顯示成「對方可能被攻擊」就是說謊（同 ADR-0278／0287 的立場）。
    expect(translate("zh-Hant", "fs_unsupportedWarning")).toContain("更新");
    expect(translate("zh-Hant", "fs_unsupportedWarning")).not.toContain("攻擊");
    const en = translate("en", "fs_unsupportedWarning").toLowerCase();
    expect(en).toContain("update");
    expect(en).not.toContain("attack");
  });

  it("🔴 常駐揭露必須講明「未經外部審計」（ADR-0306 D1 的驗收條件）", () => {
    expect(translate("zh-Hant", "fs_unaudited")).toContain("外部");
    expect(translate("zh-Hant", "fs_unaudited")).toContain("審計");
    expect(translate("en", "fs_unaudited").toLowerCase()).toContain("audit");
  });

  it("🔴 啟用確認必須重述「未經審計」，不得只說「要啟用嗎」", () => {
    expect(translate("zh-Hant", "fs_enableConfirm")).toContain("審計");
    expect(translate("en", "fs_enableConfirm").toLowerCase()).toContain("audit");
  });

  it("🔴 標題必須是「實驗性」而非「進階」（ADR-0306 §3：後者讀起來像成熟功能）", () => {
    expect(translate("zh-Hant", "fs_title")).toContain("實驗性");
    expect(translate("en", "fs_title").toLowerCase()).toContain("experimental");
  });
});

// ADR-0305 §6.1：這句文案在「還原範圍」上說得比實際多。與入口整併**脫鉤**、必改。
describe("nsec 登入的還原範圍要誠實（ADR-0305 §6.1）", () => {
  it("🔴 不得無條件宣稱「訊息會一起回來」——貼 nsec 拿不回本機歷史，也拿不回 EK", () => {
    // 事實：`fsState` 來自 `storage.loadFsState()`（本機），而備份碼刻意身分-only（0245 §2）
    // ⇒ 全新裝置貼 nsec／救援碼後，中繼 7 天窗內**加密到 EK 的那部分永遠解不開**。
    const zh = translate("zh-Hant", "signIn_useNsecHint");
    expect(zh).not.toContain("原本的聯絡人與訊息會一起回來");
  });

  it("🔴 必須指出「更早的歷史」要靠搬家或多裝置同步", () => {
    const zh = translate("zh-Hant", "signIn_useNsecHint");
    expect(zh).toMatch(/搬家|同步/);
    const en = translate("en", "signIn_useNsecHint").toLowerCase();
    expect(en).toMatch(/transfer|sync/);
  });

  it("🔴 必須指出前向保密的子鑰不含在 nsec 裡", () => {
    expect(translate("zh-Hant", "signIn_useNsecHint")).toContain("子鑰");
    expect(translate("en", "signIn_useNsecHint").toLowerCase()).toContain("subkey");
  });
});
