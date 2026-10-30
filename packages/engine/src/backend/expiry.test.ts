// 限時訊息的到期判斷（ADR-0013）：桌面與行動端共用，畫面、預覽、封存、搜尋都用同一個定義。
import { describe, expect, it } from "vitest";
import { isExpired, nextExpiryAt, visibleText } from "./expiry.js";

describe("isExpired", () => {
  it("沒有 expiresAt＝永不到期", () => {
    expect(isExpired({}, 10)).toBe(false);
  });
  it("到期時刻當下就算到期（與桌面每秒掃描的 <= 一致）", () => {
    expect(isExpired({ expiresAt: 10 }, 9)).toBe(false);
    expect(isExpired({ expiresAt: 10 }, 10)).toBe(true);
  });
});

describe("nextExpiryAt：下一次要重繪的時刻", () => {
  it("取尚未到期中最早的那個；已到期與沒限時的不算", () => {
    const msgs = [{ expiresAt: 5 }, {}, { expiresAt: 30 }, { expiresAt: 20 }];
    expect(nextExpiryAt(msgs, 10)).toBe(20);
  });
  it("沒有待到期的 → undefined（不用排計時器）", () => {
    expect(nextExpiryAt([{ expiresAt: 5 }, {}], 10)).toBeUndefined();
    expect(nextExpiryAt([], 10)).toBeUndefined();
  });
});

describe("visibleText：清單預覽與封存列顯示的文字", () => {
  it("🔴 到期 → 到期字樣，不露原文、也不露檔名", () => {
    expect(visibleText({ text: "密碼是 1234", expiresAt: 5 }, "訊息已到期", 10)).toBe("訊息已到期");
    expect(visibleText({ text: "", file: { name: "合約.pdf" }, expiresAt: 5 }, "訊息已到期", 10)).toBe("訊息已到期");
  });
  it("沒到期：檔案顯示 📎 檔名，否則原文", () => {
    expect(visibleText({ text: "週五見", expiresAt: 50 }, "x", 10)).toBe("週五見");
    expect(visibleText({ text: "", file: { name: "cat.png" } }, "x", 10)).toBe("📎 cat.png");
  });
});
