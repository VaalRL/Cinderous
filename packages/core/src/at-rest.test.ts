import { describe, expect, it } from "vitest";
import { deriveStorageKey, isSealed, openValue, sealValue } from "./at-rest.js";
import { generateSecretKey } from "./keys.js";
import { isWrapped, unwrapSecret, wrapSecret } from "./passlock-web.js";

describe("網頁/行動端靜態加密（ADR-0112）", () => {
  const sk = generateSecretKey();
  const key = deriveStorageKey(sk);

  it("往返：密文可解回原文，且密文本身不含明文", () => {
    const plain = JSON.stringify([{ id: "m1", text: "祕密訊息" }]);
    const sealed = sealValue(key, plain);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("祕密訊息");
    expect(openValue(key, sealed)).toBe(plain);
  });

  it("金鑰由 nsec 決定：換一把 nsec 就解不開（磁碟上的訊息離開 nsec 沒有意義）", () => {
    const sealed = sealValue(key, "hello");
    const other = deriveStorageKey(generateSecretKey());
    expect(openValue(other, sealed)).toBeNull();
  });

  it("同一把 nsec 導出同一把金鑰（重載後仍解得開）", () => {
    expect(deriveStorageKey(sk)).toEqual(key);
  });

  it("**舊的明文值仍讀得出來**——否則升級等於把所有人的資料變成亂碼", () => {
    const legacy = '[{"id":"m1"}]'; // ADR-0112 之前存下的，無前綴
    expect(isSealed(legacy)).toBe(false);
    expect(openValue(key, legacy)).toBe(legacy); // 原樣回傳 → 下次寫入自動加密
  });

  it("**竄改的密文回 null，不可當明文回傳**（否則竄改＝靜默的資料污染）", () => {
    const sealed = sealValue(key, "hello");
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(openValue(key, tampered)).toBeNull();
  });

  it("每次加密用不同 nonce → 同一段明文兩次密文不同", () => {
    expect(sealValue(key, "same")).not.toBe(sealValue(key, "same"));
  });
});

describe("瀏覽器密碼包裹（ADR-0112）", () => {
  const nsec = "nsec1abcdefghijklmnopqrstuvwxyz";

  it("往返：正確密碼解得開", () => {
    const blob = wrapSecret("好密碼", nsec);
    expect(unwrapSecret("好密碼", blob)).toBe(nsec);
  });

  it("密文不含 nsec，且形狀與桌面 passlock 相容（v:1 / kdf:argon2id）", () => {
    const blob = wrapSecret("pw", nsec);
    expect(blob).not.toContain(nsec);
    expect(isWrapped(blob)).toBe(true);
    const parsed = JSON.parse(blob) as { v: number; kdf: string };
    expect(parsed.v).toBe(1);
    expect(parsed.kdf).toBe("argon2id"); // 桌面的 isWrappedValue() 靠這兩欄辨識
  });

  it("密碼錯誤回 null（不區分「錯密碼」與「遭竄改」——不給攻擊者可用的訊號）", () => {
    const blob = wrapSecret("正確", nsec);
    expect(unwrapSecret("錯誤", blob)).toBeNull();
  });

  it("鹽每次隨機：同一個 nsec+密碼兩次包裹產生不同密文", () => {
    expect(wrapSecret("pw", nsec)).not.toBe(wrapSecret("pw", nsec));
  });

  it("**拒收荒謬的 KDF 參數**：毀損/惡意 blob 不該讓解鎖吃掉 GB 級記憶體", () => {
    const blob = JSON.parse(wrapSecret("pw", nsec)) as Record<string, unknown>;
    const huge = JSON.stringify({ ...blob, m: 100_000_000 }); // 宣稱 ~95 GiB
    expect(unwrapSecret("pw", huge)).toBeNull();
    expect(unwrapSecret("pw", JSON.stringify({ ...blob, t: 9999 }))).toBeNull();
  });

  it("明文 nsec 不會被誤判為包裹 blob", () => {
    expect(isWrapped(nsec)).toBe(false);
    expect(isWrapped("")).toBe(false);
  });
});
