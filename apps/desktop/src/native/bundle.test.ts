// 桌面合集打包（ADR-0355）：把拖進來的一批路徑做成單一 tar 串流。

import { describe, expect, it } from "vitest";
import { listTar, readTar, type OutgoingFileStream } from "@cinderous/core";
import { buildBundle, type BundleIo } from "./bundle";

/** 記憶體假檔案系統：`dirs` 的 key 是資料夾路徑，值是它底下的相對路徑→內容。 */
function fakeIo(files: Record<string, string>, dirs: Record<string, Record<string, string>> = {}): BundleIo {
  const enc = new TextEncoder();
  const slice = (s: string, offset: number, length: number) => enc.encode(s).subarray(offset, offset + length);
  return {
    stat: async (path) => {
      if (files[path] !== undefined) {
        return { isDir: false, size: enc.encode(files[path]).length, mtime: 111, mode: 0o644 };
      }
      if (dirs[path]) return { isDir: true, size: 0, mtime: 222, mode: 0o755 };
      return null;
    },
    listDir: async (path) =>
      Object.entries(dirs[path] ?? {}).map(([rel, body]) => ({
        rel,
        size: enc.encode(body).length,
        mtime: 333,
        mode: 0o644,
      })),
    readRange: async (path, offset, length) => slice(files[path] ?? "", offset, length),
    readRangeIn: async (base, rel, offset, length) => slice(dirs[base]?.[rel] ?? "", offset, length),
  };
}

/** 把 OutgoingFileStream 讀成 chunk 串流，好餵給 readTar。 */
async function* chunks(s: OutgoingFileStream, size = 512): AsyncGenerator<Uint8Array> {
  for (let off = 0; off < s.size; off += size) yield await s.slice(off, size);
}

async function unpack(s: OutgoingFileStream): Promise<Record<string, string>> {
  const dec = new TextDecoder();
  const out: Record<string, string> = {};
  for await (const e of readTar(chunks(s))) {
    const parts: Uint8Array[] = [];
    for await (const c of e.body) parts.push(c);
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      buf.set(p, at);
      at += p.length;
    }
    out[e.path] = dec.decode(buf);
  }
  return out;
}

describe("buildBundle", () => {
  const many = (n: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`C:/d/f${i}.txt`, `body-${i}`]));

  it("檔案數不到門檻且沒有資料夾 → 不折疊（回 null），維持逐檔聊天體驗", async () => {
    const files = many(3);
    expect(await buildBundle(Object.keys(files), fakeIo(files))).toBeNull();
  });

  it("超過門檻 → 折疊成一個 tar，內容與原檔逐字節相同", async () => {
    const files = many(9);
    const b = await buildBundle(Object.keys(files), fakeIo(files));
    expect(b).not.toBeNull();
    expect(b!.fileCount).toBe(9);
    const got = await unpack(b!.stream);
    expect(Object.keys(got)).toHaveLength(9);
    expect(got["f0.txt"]).toBe("body-0");
    expect(got["f8.txt"]).toBe("body-8");
  });

  it("只要有一個資料夾就折疊——即使總共只有一個檔", async () => {
    const b = await buildBundle(["C:/proj"], fakeIo({}, { "C:/proj": { "a/b.txt": "hi" } }));
    expect(b).not.toBeNull();
    expect(await unpack(b!.stream)).toEqual({ "proj/a/b.txt": "hi" });
  });

  it("合集內路徑帶資料夾名 → 解開後不會把一堆檔散在當前目錄", async () => {
    const dirs = { "C:/x/proj": { "src/a.ts": "A", "README.md": "R" } };
    const b = await buildBundle(["C:/x/proj"], fakeIo({}, dirs));
    expect(Object.keys(await unpack(b!.stream)).sort()).toEqual(["proj/README.md", "proj/src/a.ts"]);
  });

  it("同名檔案不互相覆蓋（不同資料夾拖進同一批）", async () => {
    const files = { "C:/a/note.txt": "one", "C:/b/note.txt": "two" };
    const b = await buildBundle(Object.keys(files), fakeIo(files), { force: true });
    const got = await unpack(b!.stream);
    expect(Object.keys(got).sort()).toEqual(["note (2).txt", "note.txt"]);
    expect(Object.values(got).sort()).toEqual(["one", "two"]);
  });

  it("讀不到的路徑（未授權／已刪除）被略過，不讓整批失敗", async () => {
    const files = many(9);
    const b = await buildBundle([...Object.keys(files), "C:/gone.txt"], fakeIo(files));
    expect(b!.fileCount).toBe(9);
  });

  it("空資料夾 → 沒有任何檔案可送，回 null", async () => {
    expect(await buildBundle(["C:/empty"], fakeIo({}, { "C:/empty": {} }))).toBeNull();
  });

  it("走訪失敗（超過上限）→ 拋出錯誤訊息，讓 UI 說得出為什麼", async () => {
    const io = { ...fakeIo({}, { "C:/big": {} }), listDir: async () => Promise.reject(new Error("檔案數超過上限 10000")) };
    await expect(buildBundle(["C:/big"], io)).rejects.toThrow(/上限/);
  });

  it("回報的名稱清單供 EXIF 警告判斷用（ADR-0273 在合集內不生效）", async () => {
    const files = { "C:/a/p.jpg": "img", "C:/a/n.txt": "txt" };
    const b = await buildBundle(Object.keys(files), fakeIo(files), { force: true });
    expect(b!.names).toEqual(["p.jpg", "n.txt"]);
  });

  it("產出的串流可被 listTar 只讀標頭列出（收件端不必解開就看得到內容）", async () => {
    const files = many(9);
    const b = await buildBundle(Object.keys(files), fakeIo(files));
    const list = await listTar((o, l) => b!.stream.slice(o, l), b!.stream.size);
    expect(list.map((e) => e.path)).toContain("f5.txt");
    expect(list.every((e) => e.mtime === 111)).toBe(true);
  });

  it("隨機存取：任意位移切出來的位元組與整份組起來一致（續傳靠這個）", async () => {
    const files = many(9);
    const b = await buildBundle(Object.keys(files), fakeIo(files));
    const whole = await b!.stream.slice(0, b!.stream.size);
    const mid = await b!.stream.slice(1000, 700);
    expect(Buffer.from(mid).equals(Buffer.from(whole.subarray(1000, 1700)))).toBe(true);
  });
});

describe("Windows 路徑（2026-09-17 審查）", () => {
  it("🔴 原生拖放給的是反斜線路徑——項目名必須只留最後一段", async () => {
    // 先前 `baseName` 的正規表示式少了一個反斜線，於是整串 `C:\\Users\\Alice\\...` 進了
    // tar 項目名。後果有兩層：送出者的使用者名稱與目錄結構夾帶給對方（隱私），
    // 而收端看到磁碟代號就整項拒收 ⇒ **一個檔都解不出來**（功能全毀）。
    // 舊測試用 "C:/proj"（正斜線），不是 Windows 實際會給的形式，所以測試綠得很安心。
    const dirs = { "C:\\Users\\Alice\\Documents\\proj": { "src/a.ts": "A" } };
    const b = await buildBundle(["C:\\Users\\Alice\\Documents\\proj"], fakeIo({}, dirs));
    const got = await unpack(b!.stream);
    expect(Object.keys(got)).toEqual(["proj/src/a.ts"]);
    expect(JSON.stringify(got)).not.toContain("Alice");
  });

  it("反斜線路徑的單檔也只留檔名", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`C:\\Users\\Bob\\f${i}.txt`, `b-${i}`]),
    );
    const b = await buildBundle(Object.keys(files), fakeIo(files));
    const got = await unpack(b!.stream);
    expect(Object.keys(got).sort()[0]).toBe("f0.txt");
    expect(JSON.stringify(got)).not.toContain("Bob");
  });

  it("混合分隔符（有些 API 給正斜線）也處理得了", async () => {
    const files = { "C:/a/x.txt": "1", "D:\\b\\y.txt": "2" };
    const b = await buildBundle(Object.keys(files), fakeIo(files), { force: true });
    expect(Object.keys(await unpack(b!.stream)).sort()).toEqual(["x.txt", "y.txt"]);
  });
});
