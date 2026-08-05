// @vitest-environment jsdom
//
// Composer 輸入層統一（ADR-0308）與斜線指令（ADR-0309）的端到端接線。
// 走真實 DOM 事件（keydown/input/mousedown），SSR 測不到，故於 jsdom 掛載。

import { act } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import type { ChatMessage, Contact, Self } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { ConversationWindow } from "./ConversationWindow.js";
import { mount } from "../test/jsdom-mount.js";

const self: Self = { pubkey: "aa".repeat(32), name: "我", status: "online", statusMessage: "" };
const bob: Contact = { pubkey: "bb".repeat(32), name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };
const messages: ChatMessage[] = [{ id: "m1", outgoing: false, text: "嗨", at: 1 }];

const view = (onSend: (text: string) => void = () => {}): JSX.Element => (
  <I18nProvider>
    <ThemeProvider>
      <ConversationWindow
        self={self}
        contact={bob}
        messages={messages}
        typing={false}
        nudgeSignal={0}
        onSend={onSend}
        onTyping={() => {}}
        onNudge={() => {}}
        onClose={() => {}}
      />
    </ThemeProvider>
  </I18nProvider>
);

const setValue = (ta: HTMLTextAreaElement, v: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(ta, v);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};

const key = (ta: HTMLTextAreaElement, init: KeyboardEventInit): void => {
  ta.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
};

beforeEach(() => {
  localStorage.clear();
});

describe("Enter 政策可設定（ADR-0308）", () => {
  it("預設：Enter 送出", async () => {
    let sent = "";
    const m = mount(view((t) => (sent = t)));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "哈囉"));
    await act(async () => key(ta, { key: "Enter" }));
    expect(sent).toBe("哈囉");
    m.unmount();
  });

  it("關閉 enterToSend：Enter 不送出（改為換行）", async () => {
    localStorage.setItem("nb.composer.enterToSend", "0");
    let sent = "";
    const m = mount(view((t) => (sent = t)));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "哈囉"));
    await act(async () => key(ta, { key: "Enter" }));
    expect(sent).toBe("");
    m.unmount();
  });

  it("關閉 enterToSend：Ctrl+Enter 仍送出", async () => {
    localStorage.setItem("nb.composer.enterToSend", "0");
    let sent = "";
    const m = mount(view((t) => (sent = t)));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "哈囉"));
    await act(async () => key(ta, { key: "Enter", ctrlKey: true }));
    expect(sent).toBe("哈囉");
    m.unmount();
  });

  it("Shift+Enter 不送出（維持換行）", async () => {
    let sent = "";
    const m = mount(view((t) => (sent = t)));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "哈囉"));
    await act(async () => key(ta, { key: "Enter", shiftKey: true }));
    expect(sent).toBe("");
    m.unmount();
  });
});

describe("IME 守衛（ADR-0308）", () => {
  it("🔴 輸入法組字中按 Enter → 不送出（選字不會把半成品送出去）", async () => {
    let sent = "";
    const m = mount(view((t) => (sent = t)));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "ㄏㄚ"));
    await act(async () => key(ta, { key: "Enter", isComposing: true } as KeyboardEventInit));
    expect(sent).toBe("");
    // 組字結束後再按才送出
    await act(async () => key(ta, { key: "Enter" }));
    expect(sent).toBe("ㄏㄚ");
    m.unmount();
  });
});

describe("斜線指令（ADR-0309）", () => {
  it("行首打 / → 出現命令列", async () => {
    const m = mount(view());
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "/"));
    expect(m.container.querySelector('[data-testid="slash-bar"]')).not.toBeNull();
    m.unmount();
  });

  it("Tab 接受 /code → 插入程式碼區塊、`/` 片段被剝除", async () => {
    const m = mount(view());
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "/code"));
    await act(async () => key(ta, { key: "Tab" }));
    expect(ta.value).toContain("```");
    expect(ta.value).not.toContain("/code");
    m.unmount();
  });

  it("Esc 關閉命令列；Enter 照常送出", async () => {
    let sent = "";
    const m = mount(view((t) => (sent = t)));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "/co"));
    await act(async () => key(ta, { key: "Escape" }));
    expect(m.container.querySelector('[data-testid="slash-bar"]')).toBeNull();
    await act(async () => key(ta, { key: "Enter" }));
    expect(sent).toBe("/co");
    m.unmount();
  });

  it("日期 3/15 與路徑 /usr/bin 不觸發命令列", async () => {
    const m = mount(view());
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "3/15"));
    expect(m.container.querySelector('[data-testid="slash-bar"]')).toBeNull();
    await act(async () => setValue(ta, "/usr/bin"));
    expect(m.container.querySelector('[data-testid="slash-bar"]')).toBeNull();
    m.unmount();
  });

  it("唯讀公告頻道不提供任何命令（ADR-0049）", async () => {
    const m = mount(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={bob}
            messages={messages}
            typing={false}
            nudgeSignal={0}
            readOnly
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(m.container.querySelector('[data-testid="slash-bar"]')).toBeNull();
    m.unmount();
  });
});

describe("企業政策 disableStickers 的 UX 閘門補完（ADR-0310）", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
  const seedTrigger = (): void => {
    localStorage.setItem(
      "nb.stickers.custom",
      JSON.stringify([{ id: "s1", label: "笑臉", svg, kind: "both", shortcode: "smile" }]),
    );
    localStorage.setItem("nb.stickers.triggers", JSON.stringify([{ trigger: "ok", ref: { pack: "__custom", id: "s1" } }]));
  };

  const withPolicy = (disabled: boolean): JSX.Element => (
    <I18nProvider>
      <ThemeProvider>
        <ConversationWindow
          self={self}
          contact={bob}
          messages={messages}
          typing={false}
          nudgeSignal={0}
          {...(disabled ? { stickersDisabled: true } : {})}
          onSend={() => {}}
          onTyping={() => {}}
          onNudge={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>
    </I18nProvider>
  );

  it("政策未開：打到觸發字會跳建議列（既有行為，ADR-0037）", async () => {
    seedTrigger();
    const m = mount(withPolicy(false));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "ok"));
    expect(m.container.querySelector('[data-testid="trigger-bar"]')).not.toBeNull();
    m.unmount();
  });

  it("🔴 政策開啟：觸發字建議列不再出現——Tab 送出貼圖的捷徑一併關閉", async () => {
    seedTrigger();
    const m = mount(withPolicy(true));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "ok"));
    expect(m.container.querySelector('[data-testid="trigger-bar"]')).toBeNull();
    m.unmount();
  });

  it("政策開啟不刪資料：觸發字表原封不動（政策解除即恢復）", async () => {
    seedTrigger();
    const before = localStorage.getItem("nb.stickers.triggers");
    const m = mount(withPolicy(true));
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => setValue(ta, "ok"));
    expect(localStorage.getItem("nb.stickers.triggers")).toBe(before);
    m.unmount();
  });

  it("政策開啟：收到的貼圖照常顯示，但不再是可點擊的「收藏」鈕", async () => {
    const sticker: ChatMessage = { id: "s", outgoing: false, text: `nb-sticker:v2:${JSON.stringify({ label: "笑臉", svg })}`, at: 1 };
    const render = (disabled: boolean): JSX.Element => (
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={bob}
            messages={[sticker]}
            typing={false}
            nudgeSignal={0}
            {...(disabled ? { stickersDisabled: true } : {})}
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>
    );
    const on = mount(render(false));
    expect(on.container.querySelector(".sticker__own")).not.toBeNull(); // 政策未開＝可收藏
    on.unmount();

    const off = mount(render(true));
    expect(off.container.querySelector(".sticker__own")).toBeNull();
    expect(off.container.querySelector('[data-testid="sticker-img"]')).not.toBeNull(); // 仍看得到
    off.unmount();
  });
});

describe("串內回覆 composer 補齊（ADR-0308）", () => {
  const threaded: ChatMessage[] = [
    { id: "root", outgoing: false, text: "根訊息", at: 1 },
    { id: "r1", outgoing: false, text: "回覆", at: 2, replyTo: "root" },
  ];

  const openThread = async (m: ReturnType<typeof mount>): Promise<HTMLTextAreaElement> => {
    const entry = m.container.querySelector('[data-testid="thread-count"]') ?? m.container.querySelector(".thread__btn");
    await act(async () => {
      entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const areas = m.container.querySelectorAll("textarea");
    return areas[areas.length - 1] as HTMLTextAreaElement;
  };

  it("串內也能用斜線指令（過去只有 @提及）", async () => {
    const m = mount(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={bob}
            messages={threaded}
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
    const ta = await openThread(m);
    expect(ta).not.toBeUndefined();
    await act(async () => setValue(ta, "/"));
    expect(m.container.querySelector('[data-testid="thread-slash-bar"]')).not.toBeNull();
    m.unmount();
  });
});

describe("群組成員的 FS 狀態（ADR-0319）", () => {
  const members = [
    { pubkey: self.pubkey, name: "我" },
    { pubkey: "bb".repeat(32), name: "Bob" },
    { pubkey: "cc".repeat(32), name: "Carol" },
    { pubkey: "dd".repeat(32), name: "Dave" },
  ];
  const state = (pk: string): "known" | "unknown" | "lost" =>
    pk === members[1]!.pubkey ? "known" : pk === members[2]!.pubkey ? "unknown" : "lost";

  const openMembers = async (withFs: boolean) => {
    const m = mount(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={bob}
            messages={messages}
            typing={false}
            nudgeSignal={0}
            groupMembers={members}
            senderName={(pk) => members.find((x) => x.pubkey === pk)?.name ?? pk}
            {...(withFs ? { fsPeerState: state } : {})}
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    await act(async () => {
      m.container.querySelector('[data-testid="members-btn"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return m;
  };

  it("未啟用 FS（未提供 fsPeerState）→ 整欄不出現", async () => {
    const m = await openMembers(false);
    expect(m.container.querySelector('[data-testid="group-fs-summary"]')).toBeNull();
    expect(m.container.querySelector('[data-testid^="member-fs-"]')).toBeNull();
    m.unmount();
  });

  it("🔴 三態各自呈現，且**自己不算在內**（自封副本永遠有 FS）", async () => {
    const m = await openMembers(true);
    expect(m.container.querySelector('[data-testid="member-fs-known"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="member-fs-unknown"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="member-fs-lost"]')).not.toBeNull();
    // 3 位其他成員各一個狀態；自己那列沒有
    expect(m.container.querySelectorAll('[data-testid^="member-fs-"]')).toHaveLength(3);
    m.unmount();
  });

  it("🔴 匯總只算其他成員：3 位中 1 位有 FS", async () => {
    const m = await openMembers(true);
    const text = m.container.querySelector('[data-testid="group-fs-summary"]')?.textContent ?? "";
    expect(text).toContain("3");
    expect(text).toContain("1");
    m.unmount();
  });

  it("🔴「未知」不是警告：只有「曾知現無」帶 ⚠", async () => {
    const m = await openMembers(true);
    expect(m.container.querySelector('[data-testid="member-fs-unknown"]')?.textContent ?? "").not.toContain("⚠");
    expect(m.container.querySelector('[data-testid="member-fs-lost"]')?.textContent ?? "").toContain("⚠");
    m.unmount();
  });
});
