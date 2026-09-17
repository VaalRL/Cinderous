// 行動端合集列（ADR-0355）：判定、能力分歧與列表。
//
// 重點在第三個測試：不支援解包的瀏覽器要顯示的是「改用系統工具」的說明，
// 不是一顆按了沒反應的按鈕。那句話寫成「瀏覽器不能解包」就會誤導 Chrome 使用者。

import type { ChatMessage } from "@cinderous/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveTheme } from "@cinderous/theme";
import { afterEach, describe, expect, it } from "vitest";
import { BundleRow, isBundleMessage } from "./BundleRow.js";

const tk = resolveTheme({ theme: "dark" });
const render = (): string => renderToStaticMarkup(<BundleRow url="blob:x" tk={tk} locale="zh-Hant" />);

const fileMsg = (over: Partial<NonNullable<ChatMessage["file"]>> = {}): ChatMessage => ({
  id: "m",
  outgoing: false,
  text: "",
  at: 1,
  file: {
    id: "t",
    name: "cinder-bundle-20260917-120000.tar",
    mime: "application/x-tar",
    size: 4096,
    sent: 4096,
    incoming: true,
    url: "blob:x",
    ...over,
  },
});

afterEach(() => {
  delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe("合集判定", () => {
  it(".tar 副檔名或 x-tar MIME 都算（對方宣告的 MIME 不一定可信）", () => {
    expect(isBundleMessage(fileMsg())).toBe(true);
    expect(isBundleMessage(fileMsg({ name: "x.bin", mime: "application/x-tar" }))).toBe(true);
    expect(isBundleMessage(fileMsg({ name: "photo.jpg", mime: "image/jpeg" }))).toBe(false);
  });

  it("自己送出的不算——要列的是**收到**的東西", () => {
    expect(isBundleMessage(fileMsg({ incoming: false }))).toBe(false);
  });

  it("🔴 沒有本機位元組（重載後 url 不留，ADR-0093）→ 不顯示列，避免給一個按了沒用的按鈕", () => {
    const m = fileMsg();
    delete m.file!.url;
    expect(isBundleMessage(m)).toBe(false);
  });
});

describe("能力分歧", () => {
  it("沒有 showDirectoryPicker（Firefox／Safari）→ 顯示改用系統工具的說明，沒有解開按鈕", () => {
    const html = render();
    expect(html).not.toContain('data-testid="bundle-extract"');
    expect(html).toContain('data-testid="bundle-unsupported"');
    expect(html).toContain("解壓縮");
  });

  it("有 showDirectoryPicker（Chromium 系）→ 顯示解開按鈕，不顯示替代說明", () => {
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => {};
    const html = render();
    expect(html).toContain('data-testid="bundle-extract"');
    expect(html).not.toContain('data-testid="bundle-unsupported"');
  });

  it("兩種瀏覽器都看得到「列出內容」——它只讀本機標頭，不需要任何權限", () => {
    expect(render()).toContain('data-testid="bundle-list"');
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => {};
    expect(render()).toContain('data-testid="bundle-list"');
  });

  it("尚未列出時不顯示空的清單容器", () => {
    expect(render()).not.toContain('data-testid="bundle-entries"');
  });
});
