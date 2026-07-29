// 解鎖畫面（ADR-0117 記住我）。
//
// 這支測試起因於一個實機回報：APK 解鎖時標題直接印出字面「歡迎回來，{name}」。
// 原因是 `unlock_title` 帶 `{name}` 佔位符，而行動端呼叫 `t("unlock_title")` **沒傳參數**
// ——桌面同一個鍵有傳，行動端漏了。TypeScript 擋不住這種漏傳（參數是選填的）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnlockScreen } from "./UnlockScreen.js";

const base = { name: "小明", onUnlock: () => true, onUseNsec: () => {}, onForget: () => {} };

describe("UnlockScreen（ADR-0281）", () => {
  it("🔴 標題要代入名字，**不得**出現字面 `{name}`", () => {
    const html = renderToStaticMarkup(<UnlockScreen {...base} locale="zh-Hant" />);
    expect(html).not.toContain("{name}");
    expect(html).toContain("歡迎回來，小明");
  });

  it("英文語系同樣代入", () => {
    const html = renderToStaticMarkup(<UnlockScreen {...base} name="Alice" locale="en" />);
    expect(html).not.toContain("{name}");
    expect(html).toContain("Welcome back, Alice");
  });

  it("名字只出現一次（先前標題與獨立一行各印一次＝重複）", () => {
    const html = renderToStaticMarkup(<UnlockScreen {...base} name="小明" locale="zh-Hant" />);
    expect(html.split("小明").length - 1).toBe(1);
  });
});
