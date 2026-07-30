// ⚠⚠ **特徵化測試**（characterization test）：斷言的是**目前的弱行為**，不是規格。
// ADR-0298 §3 記錄了它證實的缺口；**分段金鑰（ADR-0298 §2）實作之後這裡會紅**，
// 屆時應把斷言翻正為「殘留解不開」，而不是把測試刪掉（同 ADR-0294 §1.4 的交代）。
//
// ## 這支測試刻意只驗「我們這一層」
//
// 「刪除後資料是否真的從實體介質消失」**不是我們能測的**——flash 的耗損平均與預留空間讓
// 軟體沒有可靠手段保證抹除，那是已確立的硬體事實，引用即可，不該用一台 VM 去「驗證」
// （虛擬磁碟沒有耗損平均也沒有預留空間，會給出漂亮但不成立的結論）。
//
// 我們該負責的是另一半：**假如那些位元組確實留在介質上，我們的設計讓它們可讀嗎？**
// 今天的答案是「可讀」——因為所有封存塊共用**同一把**由 nsec 決定性導出的金鑰
// （`deriveStorageKey` ＝ `hkdf(sha256, sk, undefined, INFO, 32)`，**無 salt、無分段**）。
//
// ⇒ 所以 ADR-0126 的保留上限、0013 的限時訊息、0234 的無痕收回，
//    它們的**刪除保障都打了折**：拿到 nsec 的人連「已刪除」的殘留都解得開。
import { describe, expect, it } from "vitest";
import { deriveStorageKey, generateSecretKey, openValue, sealValue } from "@cinderous/core";

/**
 * 模型化「刪除只移除索引，位元組留在介質上」。
 *
 * `live` ＝ App 看得到的檔案；`residue` ＝ 曾經寫下、之後即使被「刪除」也仍在介質上的位元組。
 * 這正是 `opfs-archive.ts:104` 的 `dir.removeEntry(key)` 在 flash 上的實際語意。
 */
class ResidualSubstrate {
  readonly live = new Map<string, string>();
  readonly residue = new Map<string, string>();

  write(key: string, bytes: string): void {
    this.live.set(key, bytes);
    this.residue.set(key, bytes); // 介質上的痕跡：寫下去就在了
  }
  /** 檔案系統刪除：只移索引。**residue 一動也沒動**——這就是缺口的來源。 */
  removeEntry(key: string): void {
    this.live.delete(key);
  }
}

/** 迷你封存：與 `opfs-archive.ts:70` 同一種封裝（`sealValue(dek, json)`）。 */
function archive(disk: ResidualSubstrate, dek: Uint8Array) {
  return {
    append(convo: string, seq: number, messages: unknown): void {
      disk.write(`${convo}.${seq}.enc`, sealValue(dek, JSON.stringify(messages)));
    },
    remove(convo: string): void {
      for (const key of [...disk.live.keys()]) if (key.startsWith(`${convo}.`)) disk.removeEntry(key);
    },
  };
}

describe("封存刪除後的殘留可解性（ADR-0298 §3 的缺口）", () => {
  const sk = generateSecretKey();
  const dek = deriveStorageKey(sk);

  it("🔴 刪除之後 App 看不到了，但殘留位元組**仍能用同一把金鑰解開**", () => {
    const disk = new ResidualSubstrate();
    const arch = archive(disk, dek);
    arch.append("bob", 0, [{ id: "m1", text: "週五老地方見" }]);

    expect(disk.live.size).toBe(1);
    arch.remove("bob");
    expect(disk.live.size).toBe(0); // App 視角：刪掉了

    // 介質視角：位元組還在，而且**解得開**。
    const left = disk.residue.get("bob.0.enc");
    expect(left).toBeDefined();
    const plain = openValue(dek, left!);
    expect(plain).toContain("週五老地方見"); // ← 分段金鑰實作後這裡應改為 toBeNull()
  });

  it("🔴 `deriveStorageKey` 是決定性的且**無 salt** ⇒ 同一把 nsec 永遠導出同一把金鑰", () => {
    // 後果：**任何年代**的殘留都用得上這把金鑰——沒有「舊金鑰已作廢」這種事。
    expect(deriveStorageKey(sk)).toEqual(deriveStorageKey(sk));
    expect(deriveStorageKey(generateSecretKey())).not.toEqual(dek); // 不同 nsec 才不同
  });

  it("🔴 所有封存塊共用一把金鑰——**沒有分段**，所以無法只丟棄某個時間段", () => {
    const disk = new ResidualSubstrate();
    const arch = archive(disk, dek);
    arch.append("bob", 0, [{ id: "old", text: "去年的事" }]); // 假設是很舊的段落
    arch.append("bob", 1, [{ id: "new", text: "上週的事" }]); // 假設是最近的段落
    arch.remove("bob");

    // 同一把 dek 兩塊都開得了 ⇒ 想「只丟掉去年」在今天的構造下做不到。
    expect(openValue(dek, disk.residue.get("bob.0.enc")!)).toContain("去年的事");
    expect(openValue(dek, disk.residue.get("bob.1.enc")!)).toContain("上週的事");
  });

  it("對照組：金鑰錯誤解不開（確認上面的成功不是測試寫鬆）", () => {
    const disk = new ResidualSubstrate();
    archive(disk, dek).append("bob", 0, [{ id: "m1", text: "秘密" }]);
    expect(openValue(deriveStorageKey(generateSecretKey()), disk.residue.get("bob.0.enc")!)).toBeNull();
  });
});
