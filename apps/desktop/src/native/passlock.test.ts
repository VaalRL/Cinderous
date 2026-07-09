import { describe, expect, it } from "vitest";
import { isWrappedValue, passwordLockAvailable } from "./passlock.js";

describe("本地密碼前端橋（ADR-0067）", () => {
  it("非 Tauri 環境不提供本地密碼（無假安全感）", () => {
    expect(passwordLockAvailable()).toBe(false);
  });

  it("isWrappedValue（審查修正 #3）：認得包裹 blob；nsec/b64/備份碼信封不誤判", () => {
    expect(isWrappedValue('{"v":1,"kdf":"argon2id","m":19456,"t":2,"p":1,"salt":"x","data":"y"}')).toBe(true);
    expect(isWrappedValue("nsec1abcdef")).toBe(false);
    expect(isWrappedValue("aGVsbG8=")).toBe(false); // b64 db 金鑰
    expect(isWrappedValue('{"v":1,"ncryptsec":"ncryptsec1...","relayUrl":"wss://x"}')).toBe(false); // 備份碼信封（ADR-0070）
    expect(isWrappedValue('{"v":2,"kdf":"argon2id"}')).toBe(false);
  });
});
