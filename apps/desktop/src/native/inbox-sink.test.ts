// 收檔暫存區清理（ADR-0347／0349，2026-09-18 稽核）。
//
// 這支測試盯的是一個純粹因為「同一份程式碼跑在兩個平台」而漏掉的洞：
// `sweepInbox` 開頭是 `if (!isTauri()) return;`，於是瀏覽器那一側的 OPFS 暫存檔
// 永遠不會被回收，累積到配額爆掉連封存都寫不進去。

import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => {});
const isTauri = vi.fn(() => true);
const sweepInboxFiles = vi.fn(async () => 0);

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
vi.mock("@cinderous/engine", () => ({ sweepInboxFiles }));

const { sweepInbox } = await import("./inbox-sink.js");

describe("sweepInbox 兩個平台各掃各的", () => {
  it("Tauri：走原生暫存區（inbox_sweep）", async () => {
    invoke.mockClear();
    sweepInboxFiles.mockClear();
    isTauri.mockReturnValue(true);
    await sweepInbox();
    expect(invoke).toHaveBeenCalledWith("inbox_sweep");
    expect(sweepInboxFiles).not.toHaveBeenCalled();
  });

  it("🔴 瀏覽器：走 OPFS 暫存區——先前這裡直接 return，檔案永不回收", async () => {
    invoke.mockClear();
    sweepInboxFiles.mockClear();
    isTauri.mockReturnValue(false);
    await sweepInbox();
    expect(sweepInboxFiles).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("清理失敗不得擋住開機", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValueOnce(new Error("boom"));
    await expect(sweepInbox()).resolves.toBeUndefined();
  });
});
