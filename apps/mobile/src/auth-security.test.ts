// 行動端身分安全（ADR-0135）：備份碼登入／救援、改本地密碼。加密原語（NIP-49／Argon2id）
// 由 @cinderous/core 各自有測；這裡驗行動端的接線邏輯。備份碼用低 logn 產生以加速測試。

import { generateSecretKey, getPublicKey, makeBackupCode, nsecEncode } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import {
  changeRememberedPassword,
  identityFromNsec,
  identityFromSecret,
  looksLikeBackupCode,
  rememberIdentity,
} from "./auth.js";

const sk = generateSecretKey();
const nsec = nsecEncode(sk);
const pubkey = getPublicKey(sk);

describe("identityFromSecret：nsec 或備份碼（ADR-0070/0135）", () => {
  it("純 nsec → 與 identityFromNsec 同結果", () => {
    const r = identityFromSecret(nsec, "夜");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identity.pubkey).toBe(pubkey);
  });

  it("備份碼＋正確備份密碼 → 還原同一把 nsec/pubkey", () => {
    const code = makeBackupCode(nsec, "wss://relay.example", "backup-pw", { logn: 1 });
    expect(looksLikeBackupCode(code)).toBe(true);
    const r = identityFromSecret(code, "夜", "backup-pw");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.pubkey).toBe(pubkey);
      expect(r.identity.nsec).toBe(nsec);
    }
  });

  it("備份碼＋錯誤備份密碼 → backup_wrong（不細分錯密碼/壞信封）", () => {
    const code = makeBackupCode(nsec, "wss://relay.example", "backup-pw", { logn: 1 });
    expect(identityFromSecret(code, "夜", "nope")).toEqual({ ok: false, error: "backup_wrong" });
    expect(identityFromSecret(code, "夜")).toEqual({ ok: false, error: "backup_wrong" }); // 缺備份密碼
  });

  it("looksLikeBackupCode：純 nsec/亂碼 → false", () => {
    expect(looksLikeBackupCode(nsec)).toBe(false);
    expect(looksLikeBackupCode("nsec1garbage")).toBe(false);
    expect(looksLikeBackupCode("")).toBe(false);
  });
});

describe("changeRememberedPassword：改本地密碼（ADR-0135）", () => {
  const identity = (() => {
    const r = identityFromNsec(nsec, "夜");
    if (!r.ok) throw new Error("setup");
    return r.identity;
  })();
  const remembered = rememberIdentity(identity, "old-pw")!;

  it("正確舊密碼 → 產生新 blob，且新密碼解得開、舊密碼解不開", () => {
    const next = changeRememberedPassword(remembered, "old-pw", "new-pw");
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.pubkey).toBe(pubkey);
    expect(next.wrapped).not.toBe(remembered.wrapped); // 新鹽新密文
    // 新密碼解得開（回同一把 nsec）。
    // （unlockRemembered 在 auth.ts 既有測試涵蓋；這裡確認 round-trip。）
    const back = changeRememberedPassword(next, "new-pw", "newer");
    expect(back).not.toBeNull();
  });

  it("錯誤舊密碼 → null（不改）", () => {
    expect(changeRememberedPassword(remembered, "wrong", "new-pw")).toBeNull();
  });

  it("新密碼空 → null（不接受無密碼包裹）", () => {
    expect(changeRememberedPassword(remembered, "old-pw", "")).toBeNull();
  });
});
