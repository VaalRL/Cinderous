// 外部互通驗證：用系統 tar 工具（Windows 10+ 內建 bsdtar）解開我們寫出的 tar。
// 這不是單元測試能給的保證——它證明我們產出的是**真的 tar**，而不是只有自己讀得懂的格式。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesEntry, tarSize, writeTar, type ArchiveEntry } from "./archive.js";

const enc = new TextEncoder();

function entry(path: string, body: string): ArchiveEntry {
  return bytesEntry(path, enc.encode(body));
}

async function build(entries: ArchiveEntry[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let n = 0;
  for await (const p of writeTar(entries)) {
    parts.push(p);
    n += p.length;
  }
  const out = new Uint8Array(n);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function hasSystemTar(): boolean {
  try {
    execFileSync("tar", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

describe("tar 與系統工具互通", () => {
  it.skipIf(!hasSystemTar())("系統 tar 列得出內容且解得開，內容一致", async () => {
    const entries = [
      entry("a.txt", "hello"),
      entry("dir/b.txt", "world"),
      entry(`${"seg/".repeat(40)}deep.txt`, "deep"),
      entry("big.bin", "x".repeat(5000)),
    ];
    const bytes = await build(entries);
    expect(tarSize(entries)).toBe(bytes.length);

    const dir = mkdtempSync(join(tmpdir(), "cinder-tar-"));
    try {
      const tarPath = join(dir, "bundle.tar");
      writeFileSync(tarPath, bytes);

      // 以 cwd + 相對檔名呼叫：GNU tar 會把 `C:\…` 解讀成「主機 C 的路徑」而去連遠端。
      const run = (args: string[]): string => execFileSync("tar", args, { cwd: dir, encoding: "utf8" });

      // 1) 列表：系統工具必須認得每一個項目
      const list = run(["-tf", "bundle.tar"]);
      expect(list).toContain("a.txt");
      expect(list).toContain("dir/b.txt");
      expect(list).toContain("deep.txt");
      expect(list).toContain("big.bin");

      // 2) 解開：內容必須逐位元組相同
      const outDir = join(dir, "out");
      mkdirSync(outDir, { recursive: true });
      run(["-xf", "bundle.tar", "-C", "out"]);
      expect(readFileSync(join(outDir, "a.txt"), "utf8")).toBe("hello");
      expect(readFileSync(join(outDir, "dir", "b.txt"), "utf8")).toBe("world");
      expect(readFileSync(join(outDir, "big.bin"), "utf8").length).toBe(5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
