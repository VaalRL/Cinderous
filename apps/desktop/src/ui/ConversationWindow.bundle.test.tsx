// @vitest-environment jsdom
//
// 合集卡片（ADR-0355）：收到 .tar 時能**只讀標頭列出內容**，以及在支援的平台解開。
// 釘住兩件事：不支援解包的平台顯示的是「換個工具」的提示而不是壞掉的按鈕；
// 列表是本機讀的，不解開也不連網。

import type { ChatMessage, Contact, Self } from "@cinderous/engine";
import type { TarListEntry } from "@cinderous/core";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n.js";
import { mount } from "../test/jsdom-mount.js";
import { ThemeProvider } from "../theme.js";
import { ConversationWindow, type BundleActions } from "./ConversationWindow.js";

const self: Self = { pubkey: "aa".repeat(32), name: "我", status: "online", statusMessage: "" };
const bob: Contact = { pubkey: "bb".repeat(32), name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };

const tarMsg: ChatMessage = {
  id: "m1",
  outgoing: false,
  text: "",
  at: 1,
  file: {
    id: "t1",
    name: "cinder-bundle-20260917-120000.tar",
    mime: "application/x-tar",
    size: 4096,
    sent: 4096,
    incoming: true,
    savedPath: "C:/Users/u/Downloads/b.tar",
  },
};

const entries: TarListEntry[] = [
  { path: "proj/a.txt", size: 10, at: 512, mtime: 1, mode: 0o644 },
  { path: "proj/sub/b.bin", size: 2048, at: 1536, mtime: 2, mode: 0o755 },
];

const render = (bundle: BundleActions | null): JSX.Element => (
  <I18nProvider locale="zh-Hant">
    <ThemeProvider>
      <ConversationWindow
        self={self}
        contact={bob}
        messages={[tarMsg]}
        typing={false}
        nudgeSignal={0}
        onSend={() => {}}
        onTyping={() => {}}
        onNudge={() => {}}
        onClose={() => {}}
        onSendFile={() => {}}
        onBundle={() => bundle}
      />
    </ThemeProvider>
  </I18nProvider>
);

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("合集卡片（ADR-0355）", () => {
  it("非合集（onBundle 回 null）→ 檔案卡維持原樣，不多出任何按鈕", () => {
    const { container } = mount(render(null));
    expect(q(container, "bundle")).toBeNull();
  });

  it("按下列出內容 → 顯示每個項目的路徑與大小（只讀標頭，不解開）", async () => {
    const list = vi.fn(async () => entries);
    const { container } = mount(render({ list }));
    act(() => q(container, "bundle-list")!.click());
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    const text = q(container, "bundle-entries")!.textContent ?? "";
    expect(text).toContain("proj/a.txt");
    expect(text).toContain("proj/sub/b.bin");
  });

  it("空合集 → 說它是空的，而不是顯示一個空白清單", async () => {
    const { container } = mount(render({ list: async () => [] }));
    act(() => q(container, "bundle-list")!.click());
    await flush();
    expect(q(container, "bundle-entries")).toBeNull();
    expect(container.textContent).toContain("沒有檔案");
  });

  it("列表失敗 → 顯示原因（檔案被搬走時使用者才知道發生什麼事）", async () => {
    const { container } = mount(render({ list: async () => Promise.reject(new Error("檔案不存在")) }));
    act(() => q(container, "bundle-list")!.click());
    await flush();
    expect(q(container, "bundle-error")?.textContent).toContain("檔案不存在");
  });

  it("🔴 平台解不開（沒有 extract）→ 顯示改用其他工具的提示，不給按了沒用的按鈕", () => {
    const { container } = mount(render({ list: async () => entries }));
    expect(q(container, "bundle-extract")).toBeNull();
    expect(q(container, "bundle-unsupported")?.textContent).toContain("解壓縮");
  });

  it("平台解得開 → 顯示解開按鈕並呼叫它", async () => {
    const extract = vi.fn(async () => {});
    const { container } = mount(render({ list: async () => entries, extract }));
    expect(q(container, "bundle-unsupported")).toBeNull();
    act(() => q(container, "bundle-extract")!.click());
    await flush();
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("解包進行中按鈕停用——避免重複點擊解到一半又解一次", async () => {
    let release = (): void => {};
    const extract = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { container } = mount(render({ list: async () => entries, extract }));
    act(() => q(container, "bundle-extract")!.click());
    await flush();
    expect((q(container, "bundle-extract") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect((q(container, "bundle-extract") as HTMLButtonElement).disabled).toBe(false);
  });
});
