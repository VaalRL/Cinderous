// 送出圖片中繼資料清除（ADR-0273）：政策判定、fallback 契約、檔名調整。
//
// 註：canvas 的真實重編碼需要瀏覽器影像解碼器（node/jsdom 沒有），故此處鎖住的是
// **政策與失效契約**——「什麼該處理」「處理不了時必須原樣送出而不是擋下」。
// 實際去除 EXIF 的效果由瀏覽器 canvas 保證（只寫入像素），並列於實機驗收。
import { describe, expect, it } from "vitest";
import { isSanitizable, SEND_MAX_EDGE, SEND_QUALITY } from "./storage/types.js";
import { needsBytesToSend, sanitizedFileName, sanitizeImage, sendsUnstrippedImage } from "./image-sanitize.js";

const bytes = new Uint8Array([1, 2, 3, 4]);

describe("isSanitizable 政策（ADR-0273）", () => {
  it("點陣圖要清；GIF／SVG／非圖片不動", () => {
    expect(isSanitizable("image/jpeg")).toBe(true);
    expect(isSanitizable("image/png")).toBe(true);
    expect(isSanitizable("image/webp")).toBe(true);
    expect(isSanitizable("image/heic")).toBe(true);
    // GIF：重編碼會摧毀動畫（ADR-0222 支援動畫 GIF）
    expect(isSanitizable("image/gif")).toBe(false);
    // SVG：可執行標記，不餵 canvas（同 ADR-0102）
    expect(isSanitizable("image/svg+xml")).toBe(false);
    expect(isSanitizable("application/pdf")).toBe(false);
    expect(isSanitizable("text/plain")).toBe(false);
  });

  it("政策常數合理（送出尺寸遠大於縮圖、品質高於縮圖）", () => {
    expect(SEND_MAX_EDGE).toBeGreaterThan(1024);
    expect(SEND_QUALITY).toBeGreaterThan(0.7);
    expect(SEND_QUALITY).toBeLessThanOrEqual(1);
  });
});

describe("sanitizeImage 失效契約（ADR-0273）", () => {
  it("🔴 不適用或無 DOM 時**原樣返回**——清不掉中繼資料不該讓使用者送不出檔案", async () => {
    for (const mime of ["image/gif", "image/svg+xml", "application/pdf"]) {
      const out = await sanitizeImage(bytes, mime);
      expect(out.changed, mime).toBe(false);
      expect(out.bytes, mime).toBe(bytes); // 同一份，不複製不改動
      expect(out.mime, mime).toBe(mime);
    }
    // node 環境無 document → 圖片也走原樣返回（不丟例外）
    const img = await sanitizeImage(bytes, "image/jpeg");
    expect(img.changed).toBe(false);
    expect(img.bytes).toBe(bytes);
  });
});

describe("sanitizedFileName", () => {
  it("有重編碼才改副檔名為 .jpg（避免副檔名與實際位元組不符）", () => {
    expect(sanitizedFileName("IMG_1234.heic", true)).toBe("IMG_1234.jpg");
    expect(sanitizedFileName("photo.png", true)).toBe("photo.jpg");
    expect(sanitizedFileName("no-ext", true)).toBe("no-ext.jpg");
  });
  it("未重編碼則原樣（GIF／PDF 等保留原名）", () => {
    expect(sanitizedFileName("anim.gif", false)).toBe("anim.gif");
    expect(sanitizedFileName("doc.pdf", false)).toBe("doc.pdf");
  });
});

// ── ADR-0359：「本來該清卻沒清」要說得出口 ────────────────────────────────────

describe("sendsUnstrippedImage（ADR-0359）", () => {
  const M = 1024 * 1024;

  it("🔴 超過上限的相片＝承諾靜默失效的那一刻", () => {
    // ADR-0273 承諾送出的相片不含位置資訊；ADR-0346 為了不打掛 app 讓大圖走串流，
    // 於是這一格的照片原封不動地送出去，而使用者完全不知情。
    expect(sendsUnstrippedImage("image/jpeg", 33 * M)).toBe(true);
    expect(sendsUnstrippedImage("image/png", 500 * M)).toBe(true);
  });

  it("上限之內不提示——它們真的會被清掉", () => {
    expect(sendsUnstrippedImage("image/jpeg", 8 * M)).toBe(false);
    expect(sendsUnstrippedImage("image/jpeg", 32 * M)).toBe(false); // 邊界：等於上限仍會清
    expect(sendsUnstrippedImage("image/jpeg", 32 * M + 1)).toBe(true);
  });

  it("GIF 與 SVG 不提示——ADR-0273 本來就不處理它們，提示了只會變成狼來了", () => {
    expect(sendsUnstrippedImage("image/gif", 200 * M)).toBe(false);
    expect(sendsUnstrippedImage("image/svg+xml", 200 * M)).toBe(false);
  });

  it("非圖片不提示", () => {
    expect(sendsUnstrippedImage("application/zip", 900 * M)).toBe(false);
    expect(sendsUnstrippedImage("video/mp4", 900 * M)).toBe(false);
    expect(sendsUnstrippedImage("application/pdf", 900 * M)).toBe(false);
  });

  it("與 needsBytesToSend 是同一條線的兩側（不會出現兩邊都說不用管的縫）", () => {
    for (const size of [1, 32 * M - 1, 32 * M, 32 * M + 1, 900 * M]) {
      const streamed = !needsBytesToSend("image/jpeg", size); // 走串流＝不清
      expect(sendsUnstrippedImage("image/jpeg", size)).toBe(streamed);
    }
  });

  it("limit 可覆寫（測試與未來調參共用同一個出入口）", () => {
    expect(sendsUnstrippedImage("image/jpeg", 2 * M, 1 * M)).toBe(true);
    expect(sendsUnstrippedImage("image/jpeg", 2 * M, 4 * M)).toBe(false);
  });
});
