// 瀏覽器模式儲存的迴歸測試（ADR-0119）。
//
// ADR-0112 宣稱「web 的 localStorage 靜態加密、且不明文存 nsec」。但桌面 App 的瀏覽器分支
// 有四個地方各自 `new LocalStorage(...)` **忘了傳金鑰**——而不傳金鑰時 `LocalStorage` 是
// **靜默寫明文**的。ADR-0112 在這條路徑上整個是死碼，卻沒有任何測試會發現。
//
// 這裡把那個不變量釘死。

import { generateSecretKey, nsecEncode } from "@cinderous/core";
import { beforeEach, describe, expect, it } from "vitest";
import { browserStore } from "./browser-store.js";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return backing.size;
    },
    key: (i: number) => [...backing.keys()][i] ?? null,
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

/** 落盤的所有值串起來——要在裡面找明文。 */
const onDisk = (): string => [...backing.values()].join("\n");

describe("browserStore（ADR-0119：ADR-0112 的加密真的有接上）", () => {
  it("**有 nsec ⇒ 落盤全是密文**（訊息內容、聯絡人名都搜不到）", () => {
    const nsec = nsecEncode(generateSecretKey());
    const s = browserStore("ns", nsec);

    s.addContact({ pubkey: "bob", name: "Bob-識別字串" });
    s.appendMessage({ id: "m1", contact: "bob", outgoing: true, text: "極機密內容", at: 1 });

    expect(backing.size).toBeGreaterThan(0);
    expect(onDisk()).not.toContain("極機密內容");
    expect(onDisk()).not.toContain("Bob-識別字串");
    // 修正前這兩個 assert 都會失敗——明文就直接躺在 localStorage 裡。
  });

  it("**nsec 絕不落盤**——即使呼叫端手滑把它寫進 identity", () => {
    const nsec = nsecEncode(generateSecretKey());
    const s = browserStore("ns", nsec);

    // 就算真的存了（ADR-0118 的匯入路徑一度如此），加密後磁碟上也看不到它。
    s.saveIdentity({ nsec, name: "我" });
    expect(onDisk()).not.toContain(nsec);
    expect(onDisk()).not.toContain(nsec.slice(0, 20));
  });

  it("同一把 nsec 重開 ⇒ 讀得回來（加密不是單程票）", () => {
    const nsec = nsecEncode(generateSecretKey());
    const a = browserStore("ns", nsec);
    a.addContact({ pubkey: "bob", name: "Bob" });
    a.appendMessage({ id: "m1", contact: "bob", outgoing: false, text: "嗨", at: 1 });

    const b = browserStore("ns", nsec); // 重新開機
    expect(b.loadContacts()).toEqual([{ pubkey: "bob", name: "Bob" }]);
    expect(b.loadMessages("bob")[0]?.text).toBe("嗨");
  });

  it("**換一把 nsec 讀不到別人的資料**（DEK 由 nsec 導出 ⇒ 身分即隔離）", () => {
    const a = browserStore("ns", nsecEncode(generateSecretKey()));
    a.appendMessage({ id: "m1", contact: "bob", outgoing: false, text: "嗨", at: 1 });

    const intruder = browserStore("ns", nsecEncode(generateSecretKey()));
    expect(intruder.loadMessages("bob")).toEqual([]); // 解不開 → 當作沒有，而不是拋錯
  });
});
