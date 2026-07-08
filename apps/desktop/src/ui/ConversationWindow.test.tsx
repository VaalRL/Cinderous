import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import type { ChatMessage, Contact, MessageStatus, Self } from "../backend/types.js";
import { ConversationWindow } from "./ConversationWindow.js";

const self: Self = { pubkey: "aa", name: "我", status: "online", statusMessage: "" };
const contact: Contact = { pubkey: "bb", name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };

const mkMessages = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, outgoing: i % 2 === 0, text: `msg-${i}`, at: i }));

const render = (messages: ChatMessage[]) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
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

  it("對話串（ADR-0051）：回覆不入主頻道、根訊息顯示回覆數入口", () => {
    const html = render([
      { id: "root", outgoing: false, text: "主頻道根訊息", at: 1 },
      { id: "r1", outgoing: false, text: "串內回覆一", at: 2, replyTo: "root" },
      { id: "r2", outgoing: true, text: "串內回覆二", at: 3, replyTo: "root" },
    ]);
    expect(html).toContain("主頻道根訊息");
    // 回覆只在面板顯示，不灌進主頻道
    expect(html).not.toContain("串內回覆一");
    expect(html).not.toContain("串內回覆二");
    // 根訊息顯示回覆數入口（明確以 en 語系渲染，不依賴 OS 預設語系）
    expect(html).toContain('data-testid="thread-count"');
    expect(html).toContain("2 replies");
  });

  it("群組視窗提供成員清單時顯示 👥 成員管理入口（M9）", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={contact}
            messages={[]}
            typing={false}
            nudgeSignal={0}
            senderName={(pk) => pk}
            groupMembers={[
              { pubkey: "aa", name: "我" },
              { pubkey: "cc", name: "Carol" },
            ]}
            isGroupAdmin
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(html).toContain('data-testid="members-btn"');
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

describe("ConversationWindow 送達/已讀狀態勾（ADR-0058）", () => {
  const out = (status: MessageStatus): ChatMessage => ({ id: "x", outgoing: true, text: "hi", at: 1, status });

  it("已讀渲染 ✓✓ 與 tick--read", () => {
    const html = render([out("read")]);
    expect(html).toContain("tick--read");
    expect(html).toContain("✓✓");
  });

  it("已送出渲染單勾、非 read 色", () => {
    const html = render([out("sent")]);
    expect(html).toContain("tick--sent");
    expect(html).not.toContain("tick--read");
  });

  it("對方訊息（incoming）不顯示狀態勾", () => {
    const html = render([{ id: "y", outgoing: false, text: "hi", at: 1, status: "read" }]);
    expect(html).not.toContain("tick--");
  });
});

describe("ConversationWindow 長訊息截斷 + 展開全文", () => {
  it("超長訊息在主頻道截斷（尾端被切）並顯示『展開全文』鈕", () => {
    const long = `${"A".repeat(600)}TAILWORD`;
    const html = render([{ id: "m1", outgoing: false, text: long, at: 1 }]);
    expect(html).toContain('data-testid="expand-msg"');
    expect(html).toContain("Show full message"); // en 語系
    expect(html).not.toContain("TAILWORD"); // 尾端被截掉
  });

  it("短訊息不截斷、無展開鈕", () => {
    const html = render([{ id: "m2", outgoing: false, text: "短訊息", at: 1 }]);
    expect(html).not.toContain('data-testid="expand-msg"');
    expect(html).toContain("短訊息");
  });
});
