// 瀏覽器版的「登入 → 重新整理 → 回得來」（ADR-0122）。
//
// ## 為什麼這個測試不測 UI
//
// 這個 bug 之所以能活下來，是因為**沒有任何測試碰得到它**：開機路徑是一個 `useEffect`，
// 而這個專案所有的 UI 測試都是 SSR（`renderToStaticMarkup`）→ **`useEffect` 從不執行**。
//
// 所以這裡不渲染任何東西，直接跑那條路徑的**實質**：真的 `LocalStorage`（Argon2id/AES 都是真的）、
// 真的 `RelayChatBackend`、真的 localStorage 替身。App.tsx 的 boot effect 做的就是這幾步。

import { generateSecretKey, getPublicKey, nsecDecode, nsecEncode } from "@cinderous/core";
import { IDENTITY_UNAVAILABLE, LocalStorage, RelayChatBackend } from "@cinderous/engine";
import { createInMemoryRelayNetwork } from "@cinderous/relay";
import { beforeEach, describe, expect, it } from "vitest";
import { browserIsRemembered, browserPassEnable, browserPassForget, browserPassUnlock } from "./passlock.js";

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

/** 瀏覽器首次登入：產生金鑰、以它導出的 DEK 加密儲存、以密碼包裹 nsec 落盤。 */
async function signInBrowser(password: string) {
  const sk = generateSecretKey();
  const nsec = nsecEncode(sk);
  const pubkey = getPublicKey(sk);
  const store = new LocalStorage(pubkey, 0, sk);
  store.saveIdentity({ nsec: "", name: "我" }); // 只存名字——私鑰絕不明文落盤（ADR-0112）
  store.addContact({ pubkey: "bb".repeat(32), name: "Bob" });
  store.appendMessage({ id: "m1", contact: "bb".repeat(32), outgoing: false, text: "嗨", at: 1 });
  await browserPassEnable(pubkey, nsec, password);
  return { nsec, pubkey };
}

/** 重新整理：只剩 localStorage，記憶體裡的 nsec 沒了。 */
function reloadWith(pubkey: string, nsec: string | undefined) {
  const net = createInMemoryRelayNetwork();
  const store = new LocalStorage(pubkey, 0, nsec ? nsecDecode(nsec) : undefined);
  const backend = new RelayChatBackend(store, (h) => net.connect("me", h), "我", {
    ...(nsec ? { nsecOverride: nsec } : {}),
    expectPubkey: pubkey, // ADR-0122 的守衛
  });
  return { store, backend };
}

describe("瀏覽器版：登入 → 重新整理 → 回得來（ADR-0122）", () => {
  it("🔴 **沒有 nsec 就重載 → 引擎大聲失敗，不會靜默把你換成另一個人**", async () => {
    const { pubkey } = await signInBrowser("hunter2");

    // 這正是修正前發生的事：`override` 是 undefined → DEK 也是 undefined → 讀不出已加密的
    // identity → 引擎走 `generateSecretKey()` → **pubkey 變成另一把金鑰**，舊資料全部讀不出來，
    // 而且新的明文 nsec 被寫進 localStorage。實測確認過。
    expect(() => reloadWith(pubkey, undefined)).toThrow(IDENTITY_UNAVAILABLE);

    // 而且**什麼都沒被覆蓋**——身分還在那裡，等著被密碼解開。
    expect(await browserIsRemembered(pubkey)).toBe(true);
  });

  it("以密碼解鎖 → **同一個 pubkey、聯絡人與訊息都回來了**", async () => {
    const { pubkey } = await signInBrowser("hunter2");

    const nsec = await browserPassUnlock(pubkey, "hunter2");
    expect(nsec).toBeTruthy();

    const { store, backend } = reloadWith(pubkey, nsec!);
    expect(backend.self.pubkey).toBe(pubkey); // 還是同一個人
    expect(store.loadContacts().map((c) => c.name)).toEqual(["Bob"]);
    expect(store.loadMessages("bb".repeat(32)).map((m) => m.text)).toEqual(["嗨"]);
    backend.stop();
  });

  it("**磁碟上只有密文**——nsec 不在 localStorage 的任何一個值裡", async () => {
    const { nsec } = await signInBrowser("hunter2");
    const onDisk = [...backing.values()].join("\n");
    expect(onDisk).not.toContain(nsec);
    expect(onDisk).not.toContain(nsec.slice(0, 24));
  });

  it("密碼錯誤 → 解不開（且不區分「錯密碼」與「遭竄改」）", async () => {
    const { pubkey } = await signInBrowser("hunter2");
    expect(await browserPassUnlock(pubkey, "wrong")).toBeNull();
  });

  it("「停用密碼」＝忘記身分：blob 沒了，但**加密的資料還在原地**（貼回 nsec 就能救）", async () => {
    const { nsec, pubkey } = await signInBrowser("hunter2");
    await browserPassForget(pubkey);

    expect(await browserIsRemembered(pubkey)).toBe(false);
    expect(() => reloadWith(pubkey, undefined)).toThrow(IDENTITY_UNAVAILABLE); // 沒有金鑰＝進不去

    // 但資料沒被刪——備份的 nsec 貼回來，一切照舊。這就是 `SignIn` 的「用 nsec 登入」。
    const { store, backend } = reloadWith(pubkey, nsec);
    expect(backend.self.pubkey).toBe(pubkey);
    expect(store.loadMessages("bb".repeat(32)).map((m) => m.text)).toEqual(["嗨"]);
    backend.stop();
  });

  it("**別人的 nsec 進不來**（守衛擋下 pubkey 不符）", async () => {
    const { pubkey } = await signInBrowser("hunter2");
    const intruder = nsecEncode(generateSecretKey());
    expect(() => reloadWith(pubkey, intruder)).toThrow();
  });
});
