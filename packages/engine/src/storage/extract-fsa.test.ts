// 瀏覽器端解開合集（ADR-0355）：能力偵測與資料夾落地端。

import { bytesEntry, tarStream } from "@cinderous/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blobReader,
  canExtractToDirectory,
  directoryTarget,
  extractBlobToDirectory,
  pickExtractDirectory,
  type DirHandleLike,
} from "./extract-fsa.js";

/** 記憶體資料夾把手：記下每個檔案的位元組與「關過幾次」。 */
function fakeDir(): DirHandleLike & { files: Map<string, Uint8Array>; closes: string[] } {
  const files = new Map<string, Uint8Array>();
  const closes: string[] = [];
  const make = (prefix: string): DirHandleLike & { files: Map<string, Uint8Array>; closes: string[] } => ({
    files,
    closes,
    getDirectoryHandle: async (name) => make(`${prefix}${name}/`),
    getFileHandle: async (name) => {
      const key = `${prefix}${name}`;
      return {
        createWritable: async () => ({
          write: async (d: { position: number; data: Uint8Array }) => {
            const prev = files.get(key) ?? new Uint8Array(0);
            const next = new Uint8Array(Math.max(prev.length, d.position + d.data.length));
            next.set(prev);
            next.set(d.data, d.position);
            files.set(key, next);
          },
          close: async () => {
            closes.push(key);
            if (!files.has(key)) files.set(key, new Uint8Array(0));
          },
        }),
      };
    },
  });
  return make("");
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function bundleBlob(): Blob {
  const s = tarStream(
    [bytesEntry("proj/a.txt", enc.encode("hello")), bytesEntry("proj/sub/b.bin", enc.encode("world"))],
    "b.tar",
  );
  // Blob 需要實際位元組；測試裡的合集很小，整份取出無妨。
  return {
    size: s.size,
    slice: (a: number, b: number) => ({ arrayBuffer: async () => (await s.slice(a, b - a)).buffer }),
  } as unknown as Blob;
}

const withPicker = (fn: unknown): void => {
  (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = fn;
};

afterEach(() => {
  delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe("能力偵測", () => {
  it("沒有 showDirectoryPicker（Firefox／Safari）→ 回 false，UI 據此顯示替代說明", () => {
    expect(canExtractToDirectory()).toBe(false);
  });

  it("有 showDirectoryPicker（Chromium 系）→ 回 true", () => {
    withPicker(() => {});
    expect(canExtractToDirectory()).toBe(true);
  });

  it("使用者取消選資料夾 → 回 null，不是拋錯", async () => {
    withPicker(() => Promise.reject(new Error("AbortError")));
    expect(await pickExtractDirectory()).toBeNull();
  });

  it("不支援時選資料夾回 null（呼叫端不必先問一次能力）", async () => {
    expect(await pickExtractDirectory()).toBeNull();
  });
});

describe("資料夾落地端", () => {
  it("巢狀路徑會逐層建立資料夾，內容正確", async () => {
    const dir = fakeDir();
    const target = directoryTarget(dir);
    await target.write("a/b/c.txt", 0, enc.encode("hi"));
    await target.finalize("a/b/c.txt", { mtime: 0, mode: 0o644 });
    expect(dec.decode(dir.files.get("a/b/c.txt"))).toBe("hi");
  });

  it("🔴 同一個檔案的多塊寫進同一個串流——逐塊開關會讓後一塊蓋掉前一塊", async () => {
    const dir = fakeDir();
    const target = directoryTarget(dir);
    await target.write("big.bin", 0, enc.encode("AAAA"));
    await target.write("big.bin", 4, enc.encode("BBBB"));
    await target.finalize("big.bin", { mtime: 0, mode: 0o644 });
    expect(dec.decode(dir.files.get("big.bin"))).toBe("AAAABBBB");
    expect(dir.closes).toEqual(["big.bin"]); // 只關一次
  });

  it("空檔案也會被建立（沒有 write 只有 finalize）", async () => {
    const dir = fakeDir();
    const target = directoryTarget(dir);
    await target.finalize("empty.txt", { mtime: 0, mode: 0o644 });
    expect(dir.files.get("empty.txt")).toEqual(new Uint8Array(0));
  });
});

describe("整份解開", () => {
  it("使用者取消 → 回 null，什麼都不寫", async () => {
    withPicker(() => Promise.reject(new Error("AbortError")));
    expect(await extractBlobToDirectory(bundleBlob())).toBeNull();
  });

  it("解開一個合集：檔案數、位元組數與內容都對", async () => {
    const dir = fakeDir();
    withPicker(vi.fn(async () => dir));
    const res = await extractBlobToDirectory(bundleBlob());
    expect(res).toEqual({ files: 2, bytes: 10, skipped: [] });
    expect(dec.decode(dir.files.get("proj/a.txt"))).toBe("hello");
    expect(dec.decode(dir.files.get("proj/sub/b.bin"))).toBe("world");
  });

  it("不整份讀進記憶體：只切要的那一段", async () => {
    const slice = vi.fn((a: number, b: number) => ({ arrayBuffer: async () => new ArrayBuffer(b - a) }));
    const read = blobReader({ size: 100, slice } as unknown as Blob);
    await read(10, 4);
    expect(slice).toHaveBeenCalledWith(10, 14);
  });
});
