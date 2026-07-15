// 行動端圖片分享（ADR-0132）：原生分享選單（Web Share API）＋ 不支援時退回下載。
// 這裡驗分流，不驗真的叫出 OS 選單（那要真手機）。用假 navigator/fetch/document 驗。

import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadImageFromUrl, shareImageFromUrl } from "./share.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchBlob(type = "image/png"): void {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }));
}

describe("shareImageFromUrl（ADR-0132）", () => {
  it("支援且 canShare → 叫原生分享、回 true", async () => {
    stubFetchBlob();
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });
    expect(await shareImageFromUrl("blob:x", "cat.png", "image/png")).toBe(true);
    expect(share).toHaveBeenCalledTimes(1);
    // 帶的是 files，不是純文字/URL。
    expect(share.mock.calls[0]?.[0]).toHaveProperty("files");
  });

  it("canShare 回 false（不能分享檔案）→ 不分享、回 false（呼叫端退回下載）", async () => {
    stubFetchBlob();
    const share = vi.fn();
    vi.stubGlobal("navigator", { share, canShare: () => false });
    expect(await shareImageFromUrl("blob:x", "cat.png", "image/png")).toBe(false);
    expect(share).not.toHaveBeenCalled();
  });

  it("環境無 navigator.share（部分桌面瀏覽器）→ 回 false", async () => {
    vi.stubGlobal("navigator", {});
    expect(await shareImageFromUrl("blob:x", "cat.png", "image/png")).toBe(false);
  });

  it("使用者取消（share 丟 AbortError）→ 回 false，不外洩例外", async () => {
    stubFetchBlob();
    const share = vi.fn().mockRejectedValue(new Error("AbortError"));
    vi.stubGlobal("navigator", { share, canShare: () => true });
    expect(await shareImageFromUrl("blob:x", "cat.png", "image/png")).toBe(false);
  });
});

describe("downloadImageFromUrl（退路，ADR-0132）", () => {
  it("以 anchor 觸發下載（href=src、download=name）", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor: Record<string, unknown> = { click, remove };
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: vi.fn() },
    });
    downloadImageFromUrl("blob:x", "cat.png");
    expect(anchor.href).toBe("blob:x");
    expect(anchor.download).toBe("cat.png");
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("空來源 → 不動作（不建 anchor）", () => {
    const createElement = vi.fn();
    vi.stubGlobal("document", { createElement, body: { appendChild: vi.fn() } });
    downloadImageFromUrl("", "cat.png");
    expect(createElement).not.toHaveBeenCalled();
  });
});
