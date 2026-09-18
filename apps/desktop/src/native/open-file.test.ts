// 原生選檔／拖放的大小閘門（ADR-0346 補完 Tauri 這一側，2026-09-18 稽核）。
//
// 盯的是一個只在**打包版**炸、開發時完全看不到的洞：`readFileAtPath` 走的
// `read_saved_file` 會把整份檔案序列化成 JSON 數字陣列過 IPC。瀏覽器那一側早就靠
// `needsBytesToSend` 分流（ADR-0346），Tauri 的迴紋針與原生拖放卻照舊整份讀，
// 而收端上限已經放寬到 1 GiB——桌面版正是最可能被拿來傳大檔的那一個。

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const isTauri = vi.fn(() => true);
const stat = vi.fn();
const readRange = vi.fn(async () => new Uint8Array([1, 2, 3]));

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
vi.mock("./bundle.js", () => ({ tauriBundleIo: { stat, readRange } }));

const { openFileAtPath } = await import("./save-file.js");

const MiB = 1024 * 1024;
const file = (size: number) => ({ isDir: false, size, mtime: 0, mode: 0o644 });

beforeEach(() => {
  invoke.mockReset();
  stat.mockReset();
  readRange.mockClear();
  isTauri.mockReturnValue(true);
});

describe("openFileAtPath：大檔不進 RAM", () => {
  it("🔴 2 GiB 的壓縮檔走惰性來源——一個位元組都不經 read_saved_file", async () => {
    stat.mockResolvedValue(file(2 * 1024 * MiB));
    const src = await openFileAtPath("D:/備份/整顆硬碟.zip");
    expect(src?.kind).toBe("stream");
    expect(invoke).not.toHaveBeenCalled(); // ← 先前這裡會是 read_saved_file
    if (src?.kind !== "stream") throw new Error("unreachable");
    expect(src.stream.size).toBe(2 * 1024 * MiB);
    expect(src.stream.name).toBe("整顆硬碟.zip");
    expect(src.path).toBe("D:/備份/整顆硬碟.zip"); // 原生端總是帶得回真實路徑（ADR-0103）
  });

  it("🔴 超過 32 MiB 的圖片也走惰性——它已經不做縮圖/清 EXIF 了，沒有理由整份讀", async () => {
    stat.mockResolvedValue(file(200 * MiB));
    const src = await openFileAtPath("/home/me/掃描檔.png");
    expect(src?.kind).toBe("stream");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("slice 逐塊讀，且把位移長度原樣轉給 fs_read_range", async () => {
    stat.mockResolvedValue(file(9 * MiB));
    const src = await openFileAtPath("C:/x/large.bin");
    if (src?.kind !== "stream") throw new Error("expected stream");
    await src.stream.slice(4096, 1024);
    expect(readRange).toHaveBeenCalledWith("C:/x/large.bin", 4096, 1024);
  });

  it("小圖仍然拿位元組——縮圖（ADR-0102）與清 EXIF（ADR-0273）都非要不可", async () => {
    stat.mockResolvedValue(file(3 * MiB));
    invoke.mockResolvedValue([7, 8, 9]);
    const src = await openFileAtPath("C:/pics/自拍.jpg");
    expect(src?.kind).toBe("bytes");
    expect(invoke).toHaveBeenCalledWith("read_saved_file", { path: "C:/pics/自拍.jpg" });
    if (src?.kind !== "bytes") throw new Error("unreachable");
    expect([...src.file.bytes]).toEqual([7, 8, 9]);
    expect(src.file.mime).toBe("image/jpeg");
  });

  it("Windows 反斜線路徑也取得出檔名", async () => {
    stat.mockResolvedValue(file(500 * MiB));
    const src = await openFileAtPath("C:\\Users\\me\\Videos\\影片.mp4");
    if (src?.kind !== "stream") throw new Error("expected stream");
    expect(src.stream.name).toBe("影片.mp4");
  });

  it("資料夾回 null（由合集路徑處理，ADR-0355），不會被當成 0 位元組的檔案送出", async () => {
    stat.mockResolvedValue({ isDir: true, size: 4096, mtime: 0, mode: 0o755 });
    expect(await openFileAtPath("C:/專案")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("讀不到（已被搬走）回 null", async () => {
    stat.mockResolvedValue(null);
    expect(await openFileAtPath("C:/沒了.txt")).toBeNull();
  });

  it("非 Tauri 一律 null——瀏覽器沒有真實路徑可言", async () => {
    isTauri.mockReturnValue(false);
    expect(await openFileAtPath("/whatever")).toBeNull();
    expect(stat).not.toHaveBeenCalled();
  });
});
