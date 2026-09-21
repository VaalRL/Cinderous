// 行動端「關於／版本」（ADR-0227 P2 的行動端補課）。
//
// 🔴 這個缺口的形狀值得記下來：`vite.config.ts` **早就**設了
// `define: { __APP_VERSION__: ... }`，但行動端**沒有任何一處讀它**。
// `define` 是純文字替換 ⇒ 沒人讀就什麼都不會被注入，版號字串根本不在 bundle 裡。
// 設定檔看起來完全正常，typecheck 綠，測試綠——只是使用者永遠看不到版本號。
// （2026-09-21 發 v0.0.18、驗證成品版號時才發現。）
//
// 為什麼它不只是「少一個資訊」：ADR-0365 起，release note 會出現
// 「請把每一台裝置都更新到這一版」這種**要使用者自己核對**的指示。
// 沒有版號可看，那句話在手機上就無從執行。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsScreen } from "./SettingsScreen.js";
import { APP_VERSION } from "../version.js";

const base = {
  selfName: "夜",
  selfNpub: "npub1abc",
  selfNsec: "nsec1abc",
  relayUrl: "wss://relay.example",
  theme: "light" as const,
  onTheme: () => {},
  locale: "zh-Hant" as const,
  onLocale: () => {},
  accent: null,
  onAccent: () => {},
  invisible: false,
  onInvisible: () => {},
  onLogout: () => {},
};

const render = (p: Record<string, unknown> = {}) => renderToStaticMarkup(<SettingsScreen {...base} {...p} />);

describe("行動端設定顯示版本號", () => {
  it("🔴 版號常數真的被注入（不是 undefined、也不是字面的 __APP_VERSION__）", () => {
    // 這一條擋的是「define 設了但沒人讀」以外的另一半：define 被拿掉或打錯。
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("版號與 root package.json（SSOT）一致", async () => {
    const { readFileSync } = await import("node:fs");
    const root = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(APP_VERSION).toBe(root.version);
  });

  it("設定頁有「關於」區並印出版號", () => {
    const html = render();
    expect(html).toContain('data-testid="about-section"');
    expect(html).toContain('data-testid="about-version"');
    expect(html).toContain(APP_VERSION);
  });

  it("🔴 版號可選取——看得到不等於抄得走（要回報問題時得複製它）", () => {
    // react-native-web 的 selectable={true} 會渲染成可選取的文字節點；
    // 不可選取的話使用者只能手抄，而版號正是最常被要求回報的東西。
    const html = render();
    const at = html.indexOf('data-testid="about-version"');
    expect(at).toBeGreaterThan(-1);
    expect(html.slice(Math.max(0, at - 300), at)).not.toContain("user-select:none");
  });
});
