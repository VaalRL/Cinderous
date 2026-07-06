import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import type { ChatMessage, Contact, Self } from "../backend/types.js";
import { ConversationWindow } from "./ConversationWindow.js";

const self: Self = { pubkey: "aa", name: "我", status: "online", statusMessage: "" };
const contact: Contact = { pubkey: "bb", name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };

const mkMessages = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, outgoing: i % 2 === 0, text: `msg-${i}`, at: i }));

const render = (messages: ChatMessage[]) =>
  renderToStaticMarkup(
    <I18nProvider>
      <ThemeProvider>
        <ConversationWindow
          self={self}
          contact={contact}
          messages={messages}
          typing={false}
          nudgeSignal={0}
          onSend={() => {}}
          onTyping={() => {}}
          onNudge={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>
    </I18nProvider>,
  );

describe("ConversationWindow 訊息列視窗化（P0-3）", () => {
  it("訊息數 ≤ 視窗時全部渲染、無『載入較早』", () => {
    const html = render(mkMessages(10));
    expect(html).not.toContain('data-testid="load-earlier"');
    expect(html).toContain("msg-0");
    expect(html).toContain("msg-9");
  });

  it("超過視窗時只渲染最近 200 則、顯示『載入較早』", () => {
    const html = render(mkMessages(250));
    expect(html).toContain('data-testid="load-earlier"');
    // 最舊 50 則（0..49）被視窗化隱藏、最近的（50..249）渲染
    expect(html).not.toContain("msg-0");
    expect(html).not.toContain("msg-49");
    expect(html).toContain("msg-50");
    expect(html).toContain("msg-249");
  });

  it("@提及我的訊息以 mention class + 徽章凸顯（ADR-0050）", () => {
    const html = render([
      { id: "m1", outgoing: false, text: "一般訊息", at: 1 },
      { id: "m2", outgoing: false, text: "@我 看這個", at: 2, mentionsMe: true },
    ]);
    expect(html).toContain('class="line in mention"');
    expect(html).toContain('class="mention-badge"');
    // 未被提及的訊息不帶 mention class
    expect(html).toContain('class="line in"');
  });
});
