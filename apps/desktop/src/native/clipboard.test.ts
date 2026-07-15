// 剪貼簿（ADR-0132）：桌面的圖片分享＝快速複製。這裡驗行為分流，不驗真的寫進系統剪貼簿
// （那要真瀏覽器）。用假 navigator/ClipboardItem/Image/canvas 驗：路徑走對、失敗回 false。

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyImageFromUrl, copyText } from "./clipboard.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText（ADR-0132）", () => {
  it("有 writeText → 寫入並回 true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("C:/x/y.png")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("C:/x/y.png");
  });

  it("空字串不寫、回 false", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("")).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("環境不支援（無 clipboard）→ 回 false，不丟例外", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyText("x")).toBe(false);
  });
});

describe("copyImageFromUrl（ADR-0132）", () => {
  // 假 Image：一 load 就成功；假 canvas：toBlob 回一個 image/png Blob。
  function stubImagePipeline(pngBlob: Blob | null): { write: ReturnType<typeof vi.fn> } {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 4;
      naturalHeight = 4;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (b: Blob | null) => void) => cb(pngBlob),
      }),
    });
    class FakeClipboardItem {
      items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
    return { write };
  }

  it("成功：轉成 image/png 後寫入剪貼簿 → true", async () => {
    const png = new Blob([new Uint8Array([1])], { type: "image/png" });
    const { write } = stubImagePipeline(png);
    expect(await copyImageFromUrl("blob:abc")).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0]?.[0][0] as { items: Record<string, Blob> };
    expect(Object.keys(item.items)).toEqual(["image/png"]);
  });

  it("canvas 產不出 PNG（toBlob→null）→ 不寫、回 false", async () => {
    const { write } = stubImagePipeline(null);
    expect(await copyImageFromUrl("blob:abc")).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("環境無 ClipboardItem → 回 false（不嘗試載圖）", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
    // 不設 ClipboardItem
    vi.stubGlobal("ClipboardItem", undefined);
    expect(await copyImageFromUrl("blob:abc")).toBe(false);
  });
});
