// 另存改走暫存區（ADR-0362，2026-09-18 稽核）。
//
// 舊路徑是 `invoke("save_file", { bytes: Array.from(bytes) })`——整份檔案先變成一個
// 每格一個 JS number 的陣列，再由 Tauri 整份序列化成 JSON。收檔那側還算有界（超過
// 8 MiB 就走 sink 落盤），但**匯出紀錄那條路完全沒有上限**：用了幾年的人匯出 JSON
// 輕易上百 MB，`Array.from` 到那個尺寸是必掛的。

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const isTauri = vi.fn(() => true);

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
vi.mock("./bundle.js", () => ({ tauriBundleIo: { stat: vi.fn(), readRange: vi.fn() } }));

const { saveIncomingFile, saveTextFile } = await import("./save-file.js");

/** 這一輪呼叫過的 command 名稱，依序。 */
const calls = (): string[] => invoke.mock.calls.map((c) => c[0] as string);
/** 某個 command 的所有參數。 */
const argsOf = (name: string): Record<string, unknown>[] =>
  invoke.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  invoke.mockReset();
  isTauri.mockReturnValue(true);
  invoke.mockImplementation(async (cmd: string) => (cmd === "save_from_inbox" ? "C:/out/x.bin" : undefined));
});

describe("另存走暫存區（ADR-0362）", () => {
  it("🔴 再也不呼叫 save_file——那個 command 已經不存在了", async () => {
    await saveIncomingFile("a.bin", "application/octet-stream", new Uint8Array(10));
    expect(calls()).not.toContain("save_file");
  });

  it("順序是 begin → write → save_from_inbox", async () => {
    await saveIncomingFile("a.bin", "application/octet-stream", new Uint8Array(10));
    expect(calls()).toEqual(["inbox_begin", "inbox_write", "save_from_inbox"]);
    expect(argsOf("save_from_inbox")[0]!.name).toBe("a.bin");
  });

  it("🔴 大內容切成多塊，每一塊都有界——整份不做一次性序列化", async () => {
    const MiB = 1024 * 1024;
    await saveTextFile("紀錄.json", "application/json", "x".repeat(5 * MiB + 123));
    const writes = argsOf("inbox_write");
    expect(writes.length).toBe(6); // 5 整塊 + 尾巴
    for (const w of writes) expect((w.bytes as number[]).length).toBeLessThanOrEqual(MiB);
    // offset 必須連續且從 0 起算，否則寫出來的檔案是錯的。
    let expected = 0;
    for (const w of writes) {
      expect(w.offset).toBe(expected);
      expected += (w.bytes as number[]).length;
    }
    expect(expected).toBe(5 * MiB + 123); // 一個位元組都沒漏
  });

  it("所有寫入共用同一個 handle，且符合 Rust 的 valid_handle 白名單", async () => {
    await saveTextFile("a.txt", "text/plain", "y".repeat(3 * 1024 * 1024));
    const handles = new Set(invoke.mock.calls.map((c) => (c[1] as { handle?: string } | undefined)?.handle));
    handles.delete(undefined);
    expect(handles.size).toBe(1);
    const h = [...handles][0]!;
    // Rust 端 `valid_handle`：只收 [A-Za-z0-9._-]、必須 .part 結尾、長度 ≤128、不含 ".."。
    expect(h).toMatch(/^[A-Za-z0-9._-]+\.part$/);
    expect(h.length).toBeLessThanOrEqual(128);
    expect(h).not.toContain("..");
  });

  it("使用者取消 → 回 {} 並丟掉暫存檔（不留垃圾給 sweep 收）", async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === "save_from_inbox" ? null : undefined));
    const res = await saveIncomingFile("a.bin", "application/octet-stream", new Uint8Array(4));
    expect(res).toEqual({});
    expect(calls()).toContain("inbox_discard");
  });

  it("🔴 寫到一半失敗也要丟掉暫存檔，否則每次失敗都留一份", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "inbox_write") throw new Error("磁碟滿了");
      return undefined;
    });
    await expect(saveIncomingFile("a.bin", "x", new Uint8Array(4))).rejects.toThrow("磁碟滿了");
    expect(calls()).toContain("inbox_discard");
  });

  it("空內容也走得完整條路（begin 會建出空檔，finish 照樣移動）", async () => {
    await saveTextFile("empty.txt", "text/plain", "");
    expect(argsOf("inbox_write").length).toBe(0);
    expect(calls()).toEqual(["inbox_begin", "save_from_inbox"]);
  });
});
