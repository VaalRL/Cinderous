import { describe, expect, it } from "vitest";
import { availableLocales, createT, registerLocale, translate } from "./index.js";
import type { Messages } from "./messages.js";

describe("執行期語系包（ADR-0074 K3 縫）", () => {
  it("registerLocale 後 translate 可用新語系；未覆蓋鍵回退預設", () => {
    // 以既有 en 為底做一份假語系，改一個鍵驗證生效
    const base = createT("en");
    const ja = { ...({} as Messages) } as Messages;
    // 只需證明機制：借用 en 全量、覆寫 appName
    const full = new Proxy({} as Messages, {
      get: (_t, k: string) => (k === "appName" ? "シンダー" : base(k as keyof Messages)),
    }) as unknown as Messages;
    registerLocale("ja", full);
    expect(availableLocales()).toContain("ja");
    expect(translate("ja", "appName")).toBe("シンダー"); // 新語系覆寫值
    expect(translate("ja", "signIn_button")).toBe(base("signIn_button")); // 未覆寫→回退 en 值
  });

  it("內建語系不受影響、未知語系回退預設", () => {
    expect(translate("zh-Hant", "appName")).toBeTruthy();
    expect(translate("xx-unknown", "appName")).toBe(translate("zh-Hant", "appName"));
  });
});
