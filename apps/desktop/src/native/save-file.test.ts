// 瀏覽器下載檔名消毒（ADR-0128）。收到的檔名來自對方（遠端可控）。
// 規則與 Rust `sanitize_filename` 一致——兩邊各測各的（Rust 在 partfile.rs）。

import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "./save-file.js";

describe("sanitizeFilename（ADR-0128）", () => {
  it("一般檔名原封不動（含中文、數字、標點）", () => {
    expect(sanitizeFilename("photo.png")).toBe("photo.png");
    expect(sanitizeFilename("我的檔案 v2.pdf")).toBe("我的檔案 v2.pdf");
    expect(sanitizeFilename("report-2026_final.txt")).toBe("report-2026_final.txt");
  });

  it("🔴 路徑穿越：只留最後一段", () => {
    expect(sanitizeFilename("../../../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\Windows\\evil.exe")).toBe("evil.exe");
    expect(sanitizeFilename("/absolute/x.txt")).toBe("x.txt");
  });

  it("控制字元與 Windows 保留字元被移除", () => {
    expect(sanitizeFilename("a\nb\tc.txt")).toBe("abc.txt");
    expect(sanitizeFilename('a<b>c:"d|e?f*g.txt')).toBe("abcdefg.txt");
  });

  it("開頭的點與前後空白", () => {
    expect(sanitizeFilename("..hidden")).toBe("hidden");
    expect(sanitizeFilename("  spaced.txt  ")).toBe("spaced.txt");
  });

  it("全部清光 → 退回預設，不回空字串（<a download> 不能是空的）", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename("/../")).toBe("file");
  });

  it("超長 → 截斷", () => {
    expect(sanitizeFilename("a".repeat(300)).length).toBe(255);
  });
});
