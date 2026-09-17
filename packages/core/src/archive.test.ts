// 檔案合集（ADR-0355 第三段）：多檔／資料夾折疊成單一 tar 串流的讀寫與安全防線。
import { describe, expect, it } from "vitest";
import {
  archiveBaseName,
  bundleHasSanitizableImage,
  bytesEntry,
  type ArchiveEntry,
  extractTar,
  type ExtractTarget,
  listTar,
  type RangeReader,
  readTar,
  safeArchivePath,
  shouldArchive,
  tarSize,
  tarStream,
  writeTar,
} from "./archive.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function entry(path: string, body: string, mtime?: number): ArchiveEntry {
  return bytesEntry(path, enc.encode(body), ...(mtime !== undefined ? [{ mtime }] : []));
}

async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const p of it) {
    parts.push(p);
    total += p.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** 把 tar 位元組餵回 readTar（可指定每次餵多少，用來驗證跨邊界解析）。 */
async function* feed(bytes: Uint8Array, step: number): AsyncGenerator<Uint8Array> {
  for (let off = 0; off < bytes.length; off += step) yield bytes.subarray(off, Math.min(off + step, bytes.length));
}

async function readAll(tar: Uint8Array, step = 512): Promise<{ path: string; size: number; text: string }[]> {
  const out: { path: string; size: number; text: string }[] = [];
  for await (const e of readTar(feed(tar, step))) {
    const parts: Uint8Array[] = [];
    for await (const b of e.body) parts.push(b.slice());
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      joined.set(p, off);
      off += p.length;
    }
    out.push({ path: e.path, size: e.size, text: dec.decode(joined) });
  }
  return out;
}

describe("tar 寫入與回讀（ADR-0355 §3）", () => {
  it("單檔往返一致", async () => {
    const tar = await collect(writeTar([entry("a.txt", "hello")]));
    expect(await readAll(tar)).toEqual([{ path: "a.txt", size: 5, text: "hello" }]);
  });

  it("多檔往返一致，順序保留", async () => {
    const tar = await collect(writeTar([entry("a.txt", "one"), entry("dir/b.bin", "twotwo"), entry("c", "")]));
    expect(await readAll(tar)).toEqual([
      { path: "a.txt", size: 3, text: "one" },
      { path: "dir/b.bin", size: 6, text: "twotwo" },
      { path: "c", size: 0, text: "" },
    ]);
  });

  it("🔴 tarSize 必須與實際位元組數完全相符（file-begin 要先宣告大小，錯一個位元組就傳壞）", async () => {
    const cases: ArchiveEntry[][] = [
      [entry("a.txt", "hello")],
      [entry("a", ""), entry("b", "x")],
      [entry("exactly-512", "y".repeat(512))],
      [entry("just-over", "z".repeat(513))],
      [entry("long/".repeat(30) + "deep.txt", "d")],
    ];
    for (const entries of cases) {
      const tar = await collect(writeTar(entries));
      expect(tarSize(entries)).toBe(tar.length);
    }
  });

  it("🔴 任意餵入切片大小都能正確解析（串流解析不可假設對齊 512）", async () => {
    const entries = [entry("a.txt", "hello world"), entry("b.txt", "x".repeat(1000))];
    const tar = await collect(writeTar(entries));
    for (const step of [1, 7, 100, 512, 513, 4096]) {
      const got = await readAll(tar, step);
      expect(got.map((e) => e.path)).toEqual(["a.txt", "b.txt"]);
      expect(got[1]!.text.length).toBe(1000);
    }
  });

  it("超過 100 字元的路徑仍可往返（ustar prefix 或 GNU longname）", async () => {
    const long = `${"seg/".repeat(40)}file.txt`; // 168 字元
    const tar = await collect(writeTar([entry(long, "ok")]));
    const got = await readAll(tar);
    expect(got).toEqual([{ path: long, size: 2, text: "ok" }]);
    expect(tarSize([entry(long, "ok")])).toBe(tar.length);
  });

  it("極長路徑（超過 ustar prefix 上限）走 GNU longname，大小預估仍準確", async () => {
    const huge = `${"averyverylongsegmentname/".repeat(12)}f.txt`; // > 255
    const e = entry(huge, "v");
    const tar = await collect(writeTar([e]));
    expect(tarSize([e])).toBe(tar.length);
    expect(await readAll(tar)).toEqual([{ path: huge, size: 1, text: "v" }]);
  });

  it("以 512 的零塊結尾（標準 tar 工具才認得）", async () => {
    const tar = await collect(writeTar([entry("a", "b")]));
    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(tar.length - 1024).every((b) => b === 0)).toBe(true);
  });

  it("🔴 來源讀不出宣告的位元組 → 拋錯（否則寫出一個壞掉的 tar）", async () => {
    // 宣告 10 byte 但實際讀得到 0：檔案在打包中途被刪掉／權限沒了就是這個形狀。
    const bad: ArchiveEntry = { path: "a", size: 10, read: async () => new Uint8Array(0) };
    await expect(collect(writeTar([bad]))).rejects.toThrow(/短少/);
  });
});

describe("解包路徑消毒（zip-slip 防禦，ADR-0119/0128 延伸）", () => {
  it("一般相對路徑原樣通過", () => {
    expect(safeArchivePath("a.txt")).toBe("a.txt");
    expect(safeArchivePath("dir/sub/a.txt")).toBe("dir/sub/a.txt");
  });

  it("🔴 路徑穿越一律拒絕", () => {
    expect(safeArchivePath("../evil")).toBeNull();
    expect(safeArchivePath("a/../../evil")).toBeNull();
    expect(safeArchivePath("a/./../../evil")).toBeNull();
    expect(safeArchivePath("..")).toBeNull();
  });

  it("🔴 絕對路徑一律拒絕（POSIX 與 Windows 兩種形式）", () => {
    expect(safeArchivePath("/etc/passwd")).toBeNull();
    expect(safeArchivePath("C:/Windows/system32")).toBeNull();
    expect(safeArchivePath("C:\\Windows\\system32")).toBeNull();
    expect(safeArchivePath("\\\\server\\share")).toBeNull();
  });

  // 逐段規則刻意與 Rust 端 `sanitize_filename`（ADR-0119）一致：非法字元**移除**、
  // Windows 保留裝置名加底線前綴——同一套語意不該因為「從壓縮包來的」就換一種。
  it("🔴 反斜線視為分隔並逐段消毒（Windows 保留字與非法字元）", () => {
    expect(safeArchivePath("dir\\CON.txt")).toBe("dir/_CON.txt");
    expect(safeArchivePath('a/b<>:"|?*.txt')).toBe("a/b.txt");
  });

  it("空路徑、只有分隔、單一點 → 拒絕", () => {
    expect(safeArchivePath("")).toBeNull();
    expect(safeArchivePath("/")).toBeNull();
    expect(safeArchivePath(".")).toBeNull();
    expect(safeArchivePath("./")).toBeNull();
  });

  it("尾端斜線（目錄項）保留為目錄語意但路徑本身仍消毒", () => {
    expect(safeArchivePath("dir/")).toBe("dir");
  });

  it("🔴 控制字元與 NUL 一律剔除（檔名注入）", () => {
    expect(safeArchivePath("a\u0000b.txt")).toBe("ab.txt");
    expect(safeArchivePath("a\nb.txt")).toBe("ab.txt");
  });
});

describe("自動折疊規則（ADR-0355 §3 修訂：多檔也走合集）", () => {
  it("少量檔案不折疊——聊天情境要逐檔預覽", () => {
    expect(shouldArchive({ fileCount: 1, hasDirectory: false })).toBe(false);
    expect(shouldArchive({ fileCount: 8, hasDirectory: false })).toBe(false);
  });

  it("🔴 檔案數超過門檻就折疊（1000 檔不可產生 1000 則中繼事件）", () => {
    expect(shouldArchive({ fileCount: 9, hasDirectory: false })).toBe(true);
    expect(shouldArchive({ fileCount: 1000, hasDirectory: false })).toBe(true);
  });

  it("🔴 只要拖到資料夾就折疊，哪怕只有一個", () => {
    expect(shouldArchive({ fileCount: 1, hasDirectory: true })).toBe(true);
  });

  it("🔴 認得出合集裡有「單獨傳會被清 EXIF」的圖片（要先問過使用者）", () => {
    expect(bundleHasSanitizableImage(["a.txt", "b.pdf"])).toBe(false);
    expect(bundleHasSanitizableImage(["a.txt", "holiday.JPG"])).toBe(true);
    expect(bundleHasSanitizableImage(["p.png"])).toBe(true);
    expect(bundleHasSanitizableImage(["x.webp"])).toBe(true);
    // GIF 不在 ADR-0273 的清理範圍內（會毀掉動畫），故不觸發警告。
    expect(bundleHasSanitizableImage(["anim.gif"])).toBe(false);
    expect(bundleHasSanitizableImage([])).toBe(false);
  });

  // 檔名是給人看的，故用**本地時間**；測試也必須用本地時間建構，否則在不同時區的
  // 機器（含 CI）上會兩邊不一致——同一類坑見 i18n 測試要釘 locale。
  it("合集檔名帶時間戳且本身可作為安全檔名", () => {
    const name = archiveBaseName(new Date(2026, 8, 17, 1, 2, 3));
    expect(name).toBe("cinder-bundle-20260917-010203.tar");
    expect(safeArchivePath(name)).toBe(name);
  });
});

describe("修改時間與權限（ADR-0355 後續）", () => {
  const withMeta = (path: string, body: string, mtime: number, mode: number): ArchiveEntry => ({
    ...entry(path, body),
    mtime,
    mode,
  });

  it("🔴 mtime 與 mode 寫得進去也讀得回來（不帶＝解開後全是 1970、且失去執行位元）", async () => {
    const e = withMeta("run.sh", "#!/bin/sh\n", 1_789_000_000, 0o755);
    const tar = await collect(writeTar([e]));
    for await (const got of readTar(feed(tar, 512))) {
      expect(got.mtime).toBe(1_789_000_000);
      expect(got.mode).toBe(0o755);
      for await (const _ of got.body) {
        /* 讀掉 */
      }
    }
  });

  it("未指定時用安全預設（mtime 0、mode 644）", async () => {
    const tar = await collect(writeTar([entry("a.txt", "x")]));
    for await (const got of readTar(feed(tar, 512))) {
      expect(got.mtime).toBe(0);
      expect(got.mode).toBe(0o644);
      for await (const _ of got.body) {
        /* 讀掉 */
      }
    }
  });

  it("🔴 只取權限位元——合集來自對方，setuid 之類的位元不得跟著跑", async () => {
    // 0o4755 = setuid + 755
    const tar = await collect(writeTar([withMeta("x", "y", 1, 0o4755)]));
    for await (const got of readTar(feed(tar, 512))) {
      expect(got.mode).toBe(0o755);
      for await (const _ of got.body) {
        /* 讀掉 */
      }
    }
  });

  it("帶了 mtime/mode 不影響大小預估（tarSize 仍準確）", async () => {
    const entries = [withMeta("a", "x", 1_700_000_000, 0o755), withMeta("b/c", "yy", 1_700_000_001, 0o600)];
    const tar = await collect(writeTar(entries));
    expect(tarSize(entries)).toBe(tar.length);
  });
});

describe("只讀標頭列出內容（ADR-0355 後續）", () => {
  /** 把完整 tar 包成隨機讀取器，並記錄總共讀了多少位元組。 */
  const readerOf = (tar: Uint8Array) => {
    const stat = { bytesRead: 0, calls: 0 };
    const read = async (offset: number, len: number): Promise<Uint8Array> => {
      stat.calls += 1;
      const slice = tar.subarray(offset, Math.min(offset + len, tar.length));
      stat.bytesRead += slice.length;
      return slice;
    };
    return { read, stat };
  };

  it("列得出每個項目的路徑、大小、時間與權限", async () => {
    const entries = [
      { ...entry("a.txt", "one"), mtime: 1_700_000_000, mode: 0o644 },
      { ...entry("dir/run.sh", "#!/bin/sh"), mtime: 1_700_000_777, mode: 0o755 },
    ];
    const tar = await collect(writeTar(entries));
    const { read } = readerOf(tar);
    expect(await listTar(read, tar.length)).toEqual([
      { path: "a.txt", size: 3, at: 512, mtime: 1_700_000_000, mode: 0o644 },
      { path: "dir/run.sh", size: 9, at: 1536, mtime: 1_700_000_777, mode: 0o755 },
    ]);
  });

  it("🔴 **不讀內容**：讀取量與合集大小無關（這就是它便宜的原因）", async () => {
    // 兩個各 1 MB 的檔：內容共 2 MB，但列表只該讀幾個 512 位元組的標頭。
    const big = "x".repeat(1024 * 1024);
    const tar = await collect(writeTar([entry("a.bin", big), entry("b.bin", big)]));
    const { read, stat } = readerOf(tar);
    const list = await listTar(read, tar.length);
    expect(list.map((e) => e.path)).toEqual(["a.bin", "b.bin"]);
    expect(tar.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(stat.bytesRead).toBeLessThan(4 * 512); // 兩個標頭＋結尾零塊，就這樣
  });

  it("長路徑（GNU longname）也列得出真實路徑", async () => {
    const long = `${"averyverylongsegmentname/".repeat(12)}f.txt`;
    const tar = await collect(writeTar([entry(long, "v")]));
    const { read } = readerOf(tar);
    expect((await listTar(read, tar.length)).map((e) => e.path)).toEqual([long]);
  });

  it("空合集回空陣列（不是拋錯）", async () => {
    const tar = await collect(writeTar([]));
    const { read } = readerOf(tar);
    expect(await listTar(read, tar.length)).toEqual([]);
  });

  it("🔴 截斷的合集不會無限迴圈，就地停下", async () => {
    const tar = await collect(writeTar([entry("a.txt", "x".repeat(2000)), entry("b.txt", "y")]));
    const cut = tar.subarray(0, 700); // 第一個標頭後就切斷
    const { read } = readerOf(cut);
    const list = await listTar(read, cut.length);
    expect(list.length).toBeLessThanOrEqual(1);
  });

  it("上限擋得住惡意的超長清單", async () => {
    const many = Array.from({ length: 50 }, (_, i) => entry(`f${i}.txt`, "x"));
    const tar = await collect(writeTar(many));
    const { read } = readerOf(tar);
    expect((await listTar(read, tar.length, 10)).length).toBe(10);
  });
});

describe("可定位的合集串流（ADR-0355：接上 OutgoingFileStream）", () => {
  const entries = [entry("a.txt", "hello world"), entry("dir/b.bin", "x".repeat(1500)), entry("c", "")];

  it("size 與 tarSize、與實際位元組數三者一致", async () => {
    const st = tarStream(entries, "bundle.tar");
    const whole = await collect(writeTar(entries));
    expect(st.size).toBe(tarSize(entries));
    expect(st.size).toBe(whole.length);
  });

  it("🔴 任意位移、任意長度的切片都與整份位元組相符（隨機存取的核心保證）", async () => {
    const st = tarStream(entries, "bundle.tar");
    const whole = await collect(writeTar(entries));
    for (const [off, len] of [
      [0, 1],
      [0, 512],
      [511, 3], // 跨標頭與內容邊界
      [512, 11],
      [520, 600], // 跨內容與補零邊界
      [1000, 4096],
      [st.size - 10, 10],
      [st.size - 1, 5], // 超過結尾 → 只回剩下的
    ] as const) {
      const got = await st.slice(off, len);
      const want = whole.subarray(off, Math.min(off + len, whole.length));
      expect(Buffer.from(got).equals(Buffer.from(want)), `off=${off} len=${len}`).toBe(true);
    }
  });

  it("🔴 只讀用得到的那一段——不會為了切一小塊而讀整個項目", async () => {
    let maxRead = 0;
    const big: ArchiveEntry = {
      path: "big.bin",
      size: 10 * 1024 * 1024,
      read: async (_o, length) => {
        maxRead = Math.max(maxRead, length);
        return new Uint8Array(length);
      },
    };
    const st = tarStream([big], "b.tar");
    await st.slice(512, 4096);
    expect(maxRead).toBeLessThanOrEqual(4096);
  });

  it("續傳：從中途開始切，內容仍然對得上（位移即斷點）", async () => {
    const st = tarStream(entries, "bundle.tar");
    const whole = await collect(writeTar(entries));
    const mid = Math.floor(st.size / 2);
    const tail = await st.slice(mid, st.size - mid);
    expect(Buffer.from(tail).equals(Buffer.from(whole.subarray(mid)))).toBe(true);
  });
});

// ── 解開合集（ADR-0355）────────────────────────────────────────────────────────

/** 記憶體落地端：記下每個檔案的位元組與收尾的中繼資料。 */
function memTarget(): ExtractTarget & { files: Map<string, Uint8Array>; meta: Map<string, { mtime: number; mode: number }> } {
  const files = new Map<string, Uint8Array>();
  const meta = new Map<string, { mtime: number; mode: number }>();
  return {
    files,
    meta,
    write: async (rel, offset, bytes) => {
      const prev = files.get(rel) ?? new Uint8Array(0);
      const next = new Uint8Array(Math.max(prev.length, offset + bytes.length));
      next.set(prev);
      next.set(bytes, offset);
      files.set(rel, next);
    },
    finalize: async (rel, m) => {
      meta.set(rel, m);
    },
  };
}

/** 把一組項目做成合集，回傳 `extractTar` 要的隨機讀取器。 */
function packed(entries: ArchiveEntry[]): { read: RangeReader; total: number } {
  const s = tarStream(entries, "b.tar");
  return { read: (o, l) => s.slice(o, l), total: s.size };
}

describe("listTar 的內容位移", () => {
  it("列出的位移指向內容本身——宿主據此直接複製，位元組不必經過任何一層", async () => {
    const s = tarStream([bytesEntry("a.txt", enc.encode("hello")), bytesEntry("b.bin", enc.encode("world!"))], "b.tar");
    const list = await listTar((o, l) => s.slice(o, l), s.size);
    for (const e of list) {
      const body = await s.slice(e.at, e.size);
      expect(dec.decode(body), e.path).toBe(e.path === "a.txt" ? "hello" : "world!");
    }
  });
});

describe("八進位欄位溢位（2026-09-17 審查）", () => {
  /** 只宣告大小、不真的產生位元組——標頭是在 layout 階段就寫好的。 */
  const huge = (size: number): ArchiveEntry => ({
    path: "big.bin",
    size,
    read: async () => new Uint8Array(0),
  });

  it("🔴 單檔 ≥ 8 GiB 必須拋錯，而不是靜默把大小除以 8", () => {
    // size 欄位有 11 位八進位；8 GiB 正好需要 12 位。先前 padStart 不截短、
    // 接著最後一格被寫成 NUL ⇒ 回讀時提早停住 ⇒ 大小變成 1 GiB，
    // 而 checksum 自洽所以校驗抓不出來，整份合集從那一項之後全部解析錯位。
    expect(() => tarStream([huge(8 * 1024 ** 3)], "b.tar")).toThrow(/超出 tar 欄位容量/);
    expect(() => tarStream([huge(64 * 1024 ** 3)], "b.tar")).toThrow(/超出 tar 欄位容量/);
  });

  it("剛好裝得下的大小照常運作（8 GiB 減 1）", () => {
    const s = tarStream([huge(8 * 1024 ** 3 - 1)], "b.tar");
    expect(s.size).toBeGreaterThan(0);
  });

  it("mtime 也受同一道閘保護", () => {
    // mtime 欄位同樣是 12 格。一個荒謬的時間戳會造出同款腐蝕。
    expect(() => tarStream([{ ...huge(1), mtime: 8 ** 12 }], "b.tar")).toThrow(/超出 tar 欄位容量/);
  });

  it("tarSize 與 tarStream 對同一組項目的態度一致（要嘛都成功、要嘛都拋）", () => {
    const ok = [huge(1024)];
    expect(tarSize(ok)).toBe(tarStream(ok, "b.tar").size);
  });
});

describe("extractTar", () => {
  const text = (s: string) => new TextEncoder().encode(s);
  const str = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

  it("解開後每個檔案的位元組、修改時間與權限都與來源相同", async () => {
    const { read, total } = packed([
      bytesEntry("a.txt", text("hello"), { mtime: 1700000000, mode: 0o644 }),
      bytesEntry("sub/b.sh", text("#!/bin/sh"), { mtime: 1700000001, mode: 0o755 }),
    ]);
    const target = memTarget();
    const res = await extractTar(read, total, target);
    expect(res.files).toBe(2);
    expect(str(target.files.get("a.txt"))).toBe("hello");
    expect(str(target.files.get("sub/b.sh"))).toBe("#!/bin/sh");
    expect(target.meta.get("sub/b.sh")).toEqual({ mtime: 1700000001, mode: 0o755 });
  });

  it("🔴 穿越路徑被跳過而不是寫出去，其餘檔案照常解開", async () => {
    const { read, total } = packed([
      bytesEntry("../../evil.sh", text("rm -rf /")),
      bytesEntry("ok.txt", text("fine")),
    ]);
    const target = memTarget();
    const res = await extractTar(read, total, target);
    expect(res.skipped).toEqual(["../../evil.sh"]);
    expect(res.files).toBe(1);
    expect([...target.files.keys()]).toEqual(["ok.txt"]);
  });

  it("被跳過的項目仍然讀完內容——否則下一個項目就對不齊了", async () => {
    const { read, total } = packed([
      bytesEntry("/abs/evil.bin", new Uint8Array(1500).fill(7)), // 內容跨多個 512 區塊
      bytesEntry("after.txt", text("still here")),
    ]);
    const target = memTarget();
    await extractTar(read, total, target);
    expect(str(target.files.get("after.txt"))).toBe("still here");
  });

  it("空檔案也算一個檔（不會因為沒有 write 就漏掉）", async () => {
    const { read, total } = packed([bytesEntry("empty.txt", new Uint8Array(0), { mtime: 5, mode: 0o600 })]);
    const target = memTarget();
    const res = await extractTar(read, total, target);
    expect(res.files).toBe(1);
    expect(target.meta.get("empty.txt")).toEqual({ mtime: 5, mode: 0o600 });
  });

  it("來源被截斷 → 已解出的檔案仍然有效，不整批失敗", async () => {
    const { read, total } = packed([bytesEntry("a.txt", text("A")), bytesEntry("b.txt", text("B"))]);
    const cut = Math.floor(total / 2);
    const target = memTarget();
    const res = await extractTar((o, l) => read(o, Math.max(0, Math.min(l, cut - o))), total, target);
    expect(res.files).toBeGreaterThanOrEqual(1);
    expect(str(target.files.get("a.txt"))).toBe("A");
  });

  it("回報進度（供 UI 顯示解包到哪了）", async () => {
    const { read, total } = packed([bytesEntry("a.txt", text("A")), bytesEntry("b.txt", text("BB"))]);
    const seen: number[] = [];
    await extractTar(read, total, memTarget(), { onProgress: (done) => seen.push(done) });
    expect(seen).toEqual([1, 3]);
  });

  it("跨切片邊界的大檔案內容正確（讀取器給的長度與 tar 區塊不對齊）", async () => {
    const big = new Uint8Array(5000).map((_, i) => i % 251);
    const { read, total } = packed([bytesEntry("big.bin", big)]);
    const target = memTarget();
    await extractTar(read, total, target, { sliceBytes: 333 });
    expect(Buffer.from(target.files.get("big.bin")!).equals(Buffer.from(big))).toBe(true);
  });
});
