// OPFS 收檔暫存區的開機清理（ADR-0355）。
//
// 收檔是「先落盤再另存」，使用者在另存前關掉分頁就留下一份 `.part`。單檔有上限但會累積，
// 而 OPFS 的配額是整個來源共用的——撐爆了連封存（ADR-0111）都寫不進去。

import { describe, expect, it, vi, afterEach } from "vitest";
import { sweepInboxFiles } from "./opfs-file-sink.js";

const DAY = 24 * 3600 * 1000;

/** 假 OPFS：只實作清理會用到的那幾個方法。 */
function fakeOpfs(files: Record<string, number>): { removed: string[] } {
  const removed: string[] = [];
  const dir = {
    keys: async function* () {
      for (const k of Object.keys(files)) yield k;
    },
    getFileHandle: async (name: string) => {
      if (!(name in files)) throw new Error("not found");
      return { getFile: async () => ({ lastModified: files[name]! }) };
    },
    removeEntry: async (name: string) => {
      removed.push(name);
      delete files[name];
    },
    getDirectoryHandle: async () => dir,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { getDirectory: async () => dir } },
  });
  return { removed };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sweepInboxFiles", () => {
  it("刪掉過期的 .part，保留還新的", async () => {
    const now = 10 * DAY;
    const { removed } = fakeOpfs({ "old.part": now - 2 * DAY, "fresh.part": now - 60_000 });
    expect(await sweepInboxFiles(DAY, now)).toBe(1);
    expect(removed).toEqual(["old.part"]);
  });

  it("🔴 只碰 .part——暫存區以外的東西（封存塊）一律不動", async () => {
    const now = 10 * DAY;
    const { removed } = fakeOpfs({ "old.part": now - 5 * DAY, "archive.enc": now - 5 * DAY });
    await sweepInboxFiles(DAY, now);
    expect(removed).toEqual(["old.part"]);
  });

  it("沒有 OPFS（Node／舊瀏覽器）→ 回 0，不拋", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    expect(await sweepInboxFiles()).toBe(0);
  });

  it("單一檔案清不掉不影響其他檔案", async () => {
    const now = 10 * DAY;
    const files: Record<string, number> = { "a.part": now - 5 * DAY, "gone.part": now - 5 * DAY };
    const { removed } = fakeOpfs(files);
    delete files["gone.part"]; // 列舉後才消失 → getFileHandle 會拋
    expect(await sweepInboxFiles(DAY, now)).toBe(1);
    expect(removed).toEqual(["a.part"]);
  });
});
