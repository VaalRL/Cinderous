// 行動端剪貼簿（ADR-0135）：複製備份碼等文字。驗行為分流，不驗真的寫進系統剪貼簿。

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText（ADR-0135）", () => {
  it("有 writeText → 寫入並回 true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("nb-backup...")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("nb-backup...");
  });

  it("空字串不寫、回 false", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("")).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("環境不支援（無 clipboard）→ false，不丟例外", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyText("x")).toBe(false);
  });
});
