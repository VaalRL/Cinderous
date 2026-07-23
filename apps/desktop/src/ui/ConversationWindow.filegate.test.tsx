// @vitest-environment jsdom
//
// 檔案按鈕依連線狀態停用（ADR-0244 過渡）：公共站無 P2P 直連、又無 relay 檔案後備時，
// 按 📎/🎤 只會產生「靜默送不出」的佔位。這裡釘住「canSendFile=false → 按鈕停用」。

import type { Contact, Self } from "@cinderous/engine";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { mount } from "../test/jsdom-mount.js";
import { ThemeProvider } from "../theme.js";
import { ConversationWindow } from "./ConversationWindow.js";

const self: Self = { pubkey: "aa".repeat(32), name: "我", status: "online", statusMessage: "" };
const bob: Contact = { pubkey: "bb".repeat(32), name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };

const render = (canSendFile?: boolean): JSX.Element => (
  <I18nProvider>
    <ThemeProvider>
      <ConversationWindow
        self={self}
        contact={bob}
        messages={[]}
        typing={false}
        nudgeSignal={0}
        onSend={() => {}}
        onTyping={() => {}}
        onNudge={() => {}}
        onClose={() => {}}
        onSendFile={() => {}}
        {...(canSendFile !== undefined ? { canSendFile } : {})}
      />
    </ThemeProvider>
  </I18nProvider>
);

const fileBtn = (c: HTMLElement) => c.querySelector('[data-testid="file-attach"]') as HTMLButtonElement | null;
const voiceBtn = (c: HTMLElement) => c.querySelector('[data-testid="voice-record"]') as HTMLButtonElement | null;

describe("檔案按鈕依連線狀態停用（ADR-0244 過渡）", () => {
  it("canSendFile=false → 📎 與 🎤 停用（避免靜默送不出）", () => {
    const { container } = mount(render(false));
    expect(fileBtn(container)?.disabled).toBe(true);
    expect(voiceBtn(container)?.disabled).toBe(true);
  });

  it("canSendFile=true → 啟用", () => {
    const { container } = mount(render(true));
    expect(fileBtn(container)?.disabled).toBe(false);
    expect(voiceBtn(container)?.disabled).toBe(false);
  });

  it("未提供 canSendFile（群組/示範）→ 啟用（沿用舊行為，不 gate）", () => {
    const { container } = mount(render(undefined));
    expect(fileBtn(container)?.disabled).toBe(false);
    expect(voiceBtn(container)?.disabled).toBe(false);
  });
});
