// @vitest-environment jsdom
//
// 已讀觸發的 **useEffect** 測試（Tier 4 / ADR-0130）。
//
// `ConversationWindow` 有一段：
// ```ts
// useEffect(() => { onMarkRead?.(); }, [contact.pubkey, messages.length, onMarkRead]);
// ```
// 這是**開窗與新訊息到達時送已讀回條、清未讀徽章**的觸發（ADR-0058）。它寫在 useEffect 裡，
// 所以過去**所有 SSR 測試都碰不到它**——「開對話是否真的觸發 markRead」一直零覆蓋。
// 這正是 ADR-0122 那個 P0（開機 effect）能躲過測試的同一類盲區。這裡在 jsdom 掛載、跑真的
// effect 來釘住它。

import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Contact, Self } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { ConversationWindow } from "./ConversationWindow.js";
import { mount } from "../test/jsdom-mount.js";

const self: Self = { pubkey: "aa".repeat(32), name: "我", status: "online", statusMessage: "" };
const bob: Contact = { pubkey: "bb".repeat(32), name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };
const msg = (id: string): ChatMessage => ({ id, outgoing: false, text: id, at: 1 });

const render = (messages: ChatMessage[], onMarkRead: () => void): JSX.Element => (
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
        onMarkRead={onMarkRead}
      />
    </ThemeProvider>
  </I18nProvider>
);

describe("已讀觸發 useEffect（ADR-0130）", () => {
  it("🔴 **開窗即觸發 onMarkRead**——這是 SSR 測不到的已讀回條觸發", () => {
    const onMarkRead = vi.fn();
    mount(render([msg("m1"), msg("m2")], onMarkRead));
    // 修正前：effect 不跑 → 這個 spy 永遠是 0 次，「開窗送已讀」根本沒被任何測試驗證過。
    expect(onMarkRead).toHaveBeenCalledTimes(1);
  });

  it("**新訊息到達（messages.length 變動）→ 再次觸發**（effect 依 length 重跑）", () => {
    const onMarkRead = vi.fn();
    const m = mount(render([msg("m1")], onMarkRead));
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    m.rerender(render([msg("m1"), msg("m2")], onMarkRead)); // 多一則 → length 變 → effect 重跑
    expect(onMarkRead).toHaveBeenCalledTimes(2);
  });

  it("同一批訊息重渲染（length 沒變）→ **不重複觸發**（避免無謂回條）", () => {
    const onMarkRead = vi.fn();
    const m = mount(render([msg("m1"), msg("m2")], onMarkRead));
    m.rerender(render([msg("m1"), msg("m2")], onMarkRead)); // 同樣兩則
    expect(onMarkRead).toHaveBeenCalledTimes(1); // deps 沒變 → effect 不重跑
  });
});
