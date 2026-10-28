// 檔案塊的程式碼搬到 SDK 後，kind 常數在 SDK 裡另外定義了一份（SDK ADR 0011 §1）。
// App 的 kind 總表（constants.ts）與 SDK 必須是同一組數字，否則 App 送出的檔案塊 SDK 認不得。
import { describe, expect, it } from "vitest";
import { FILE_CHUNK_KIND, FILE_WRAP_KIND } from "@cinderous/client/sync";
import { KIND } from "./constants.js";

describe("檔案塊 kind：App 總表與 SDK 一致", () => {
  it("FILE_WRAP 與 FILE_CHUNK", () => {
    expect(FILE_WRAP_KIND).toBe(KIND.FILE_WRAP);
    expect(FILE_CHUNK_KIND).toBe(KIND.FILE_CHUNK);
  });
});
