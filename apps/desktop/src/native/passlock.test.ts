import { describe, expect, it } from "vitest";
import { isWrappedValue, passwordLockAvailable } from "./passlock.js";

describe("本地密碼前端橋（ADR-0067）", () => {
  it("**瀏覽器也提供本地密碼**（ADR-0112 推翻 ADR-0067 的「假安全感」推論）", () => {
    // 舊決策：瀏覽器無 OS 金鑰庫 → 提供密碼保護是「假安全感」→ 不提供。
    // 但**不提供的結果不是誠實，而是 nsec 明文躺在 localStorage**。
    // Argon2id 包裹在瀏覽器提供的是與桌面**相同**的靜態保護（KEK 由密碼導出、從不落盤）；
    // 它擋不住頁面內的惡意 JS——但桌面的 webview 同樣擋不住。
    expect(passwordLockAvailable()).toBe(true);
  });

  it("isWrappedValue（審查修正 #3）：認得包裹 blob；nsec/b64/備份碼信封不誤判", () => {
    expect(isWrappedValue('{"v":1,"kdf":"argon2id","m":19456,"t":2,"p":1,"salt":"x","data":"y"}')).toBe(true);
    expect(isWrappedValue("nsec1abcdef")).toBe(false);
    expect(isWrappedValue("aGVsbG8=")).toBe(false); // b64 db 金鑰
    expect(isWrappedValue('{"v":1,"ncryptsec":"ncryptsec1...","relayUrl":"wss://x"}')).toBe(false); // 備份碼信封（ADR-0070）
    expect(isWrappedValue('{"v":2,"kdf":"argon2id"}')).toBe(false);
  });
});
