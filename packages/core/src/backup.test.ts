import { describe, expect, it } from "vitest";
import { isBackupCode, makeBackupCode, parseBackupCode, peekBackupRelay } from "./backup.js";
import { generateSecretKey, nsecEncode } from "./keys.js";

// 測試用低成本 scrypt（logn 4）；正式預設 16（NIP-49 標準預設）。
const LOGN = 4;

describe("加密備份碼（ADR-0070 混合式）", () => {
  it("往返：nsec＋relayUrl 以備份密碼還原；ncryptsec 內層可獨立解（NIP-49 互通）", () => {
    const nsec = nsecEncode(generateSecretKey());
    const code = makeBackupCode(nsec, "wss://home.example", "備份密碼🔑", { logn: LOGN });
    expect(code).not.toContain(nsec.slice(5, 20)); // 不含明文私鑰
    expect(code).toContain("ncryptsec1"); // 內層為標準 NIP-49（他家客戶端可匯入）
    const restored = parseBackupCode(code, "備份密碼🔑");
    expect(restored).toEqual({ nsec, relayUrl: "wss://home.example" });
  });

  it("密碼錯誤與格式不符拋錯", () => {
    const code = makeBackupCode(nsecEncode(generateSecretKey()), "wss://x", "right", { logn: LOGN });
    expect(() => parseBackupCode(code, "wrong")).toThrow();
    expect(() => parseBackupCode("not json", "right")).toThrow();
    expect(() => parseBackupCode(JSON.stringify({ v: 2 }), "right")).toThrow();
  });

  it("isBackupCode：備份碼判真；nsec／npub／一般文字判假（供匯入欄位自動判別）", () => {
    const code = makeBackupCode(nsecEncode(generateSecretKey()), "wss://x", "pw", { logn: LOGN });
    expect(isBackupCode(code)).toBe(true);
    expect(isBackupCode("nsec1abc")).toBe(false);
    expect(isBackupCode("npub1abc")).toBe(false);
    expect(isBackupCode("{}")).toBe(false);
  });

  it("peekBackupRelay：不需密碼可讀信封 relay（明文欄位）；非備份碼回 undefined", () => {
    const code = makeBackupCode(nsecEncode(generateSecretKey()), "wss://home.example", "pw", { logn: LOGN });
    expect(peekBackupRelay(code)).toBe("wss://home.example");
    expect(peekBackupRelay("nsec1abc")).toBeUndefined();
  });
});
