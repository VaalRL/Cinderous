// @vitest-environment jsdom
//
// 行內自訂 emoji（ADR-0220）端到端接線：渲染（收到含資產清單的訊息 → 行內小圖）與
// 收到自動收藏（effect 寫入本機庫）。這些走 useEffect / DOM，SSR 測不到，故於 jsdom 掛載。

import { describe, expect, it } from "vitest";
import { appendAssetManifest, contentHash } from "@cinderous/core";
import type { ChatMessage, Contact, Self } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { ConversationWindow } from "./ConversationWindow.js";
import { mount } from "../test/jsdom-mount.js";

const self: Self = { pubkey: "aa".repeat(32), name: "我", status: "online", statusMessage: "" };
const bob: Contact = { pubkey: "bb".repeat(32), name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };
const smiley =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ffd84d"/></svg>';

const render = (messages: ChatMessage[]): JSX.Element => (
  <I18nProvider>
    <ThemeProvider>
      <ConversationWindow
        self={self}
        contact={bob}
        messages={messages}
        typing={false}
        nudgeSignal={0}
        onSend={() => {}}
        onTyping={() => {}}
        onNudge={() => {}}
        onClose={() => {}}
      />
    </ThemeProvider>
  </I18nProvider>
);

describe("行內自訂 emoji 渲染與自動收藏（ADR-0220）", () => {
  it("收到含資產清單的訊息 → 行內渲染 emoji 小圖、不顯示 nb-assets 字面", () => {
    localStorage.clear();
    const text = appendAssetManifest("嗨 :party: 好", { party: { label: "派對", svg: smiley } });
    const m = mount(render([{ id: "m1", outgoing: false, text, at: 1 }]));
    const img = m.container.querySelector("img.emoji");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe(":party:");
    expect(m.container.textContent ?? "").not.toContain("nb-assets");
    m.unmount();
  });

  it("未知短碼保留字面（無對應資產＝不誤渲染）", () => {
    localStorage.clear();
    const m = mount(render([{ id: "m2", outgoing: false, text: "沒有 :nope: 這顆", at: 1 }]));
    expect(m.container.querySelector("img.emoji")).toBeNull();
    expect(m.container.textContent ?? "").toContain(":nope:");
    m.unmount();
  });

  it("收到即自動收藏：資產寫入本機庫（getKv）", () => {
    localStorage.clear();
    const text = appendAssetManifest(":party:", { party: { label: "派對", svg: smiley } });
    const m = mount(render([{ id: "m3", outgoing: false, text, at: 1 }]));
    const saved = localStorage.getItem("nb.stickers.custom");
    expect(saved).toBeTruthy();
    const lib = JSON.parse(saved ?? "[]") as Array<{ id: string; shortcode?: string }>;
    expect(lib.some((a) => a.id === contentHash(smiley) && a.shortcode === "party")).toBe(true);
    m.unmount();
  });

  it("自己送出的訊息不自動收藏（只收別人的）", () => {
    localStorage.clear();
    const text = appendAssetManifest(":party:", { party: { label: "派對", svg: smiley } });
    const m = mount(render([{ id: "m4", outgoing: true, text, at: 1 }]));
    expect(localStorage.getItem("nb.stickers.custom")).toBeNull();
    m.unmount();
  });
});
