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
