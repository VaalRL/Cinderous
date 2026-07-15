// 行動端多身分儲存（ADR-0138）：登錄採用、每身分密碼包裹 blob、舊單一身分遷移。
// 純狀態轉換在 @cinder/engine（profiles）已測；這裡驗行動端的儲存/遷移接線。
// node 無 localStorage → Map shim。Argon2id 包裹較慢，故盡量只包一次、其餘走 put/get。

import { generateSecretKey, getPublicKey, npubEncode, nsecEncode } from "@cinder/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { identityFromNsec, type MobileIdentity, rememberIdentity, type RememberedIdentity } from "./auth.js";
import {
  activeProfile,
  getRemembered,
  isOwnIdentity,
  loadIdentities,
  putRemembered,
  rememberInProfile,
  removeIdentity,
  renameIdentity,
  switchActive,
  visibleProfiles,
} from "./identities.js";

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function mkIdentity(name: string): MobileIdentity {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const r = identityFromNsec(nsecEncode(sk), name);
  if (!r.ok) throw new Error("setup");
  return r.identity;
}

const RELAY = "wss://relay.example";

describe("loadIdentities：遷移舊單一身分（ADR-0138）", () => {
  it("無登錄、無舊身分 → 空登錄", () => {
    const s = loadIdentities(RELAY);
    expect(s).toEqual({ profiles: [], active: null });
  });

  it("有舊 nb.remembered、無登錄 → 遷成一個 profile、複製 blob、清舊鍵、設作用中", () => {
    const id = mkIdentity("夜");
    const r = rememberIdentity(id, "pw")!;
    store.set("nb.remembered", JSON.stringify(r)); // 舊的單一記住身分

    const s = loadIdentities(RELAY);
    expect(s.profiles).toHaveLength(1);
    expect(s.active).toBe(id.pubkey);
    expect(s.profiles[0]).toMatchObject({ pubkey: id.pubkey, name: "夜", relayUrl: RELAY, namespace: id.pubkey });
    // blob 複製到 per-pubkey 鍵、舊鍵清掉（單一真實來源）。
    expect(getRemembered(id.pubkey)?.pubkey).toBe(id.pubkey);
    expect(store.has("nb.remembered")).toBe(false);
    // 已寫入登錄。
    expect(store.has("nb.profiles")).toBe(true);
  });

  it("已有登錄 → 原樣返回，不重新遷移", () => {
    const id = mkIdentity("夜");
    const r = rememberIdentity(id, "pw")!;
    rememberInProfile({ profiles: [], active: null }, id, "pw", RELAY); // 建一個登錄
    store.set("nb.remembered", JSON.stringify(r)); // 即使還有舊鍵
    const s = loadIdentities(RELAY);
    expect(s.profiles).toHaveLength(1);
    expect(store.has("nb.remembered")).toBe(true); // 有登錄就不動舊鍵
  });
});

describe("getRemembered / putRemembered（ADR-0138）", () => {
  it("round-trip；非 Argon2id blob（明文）一律不收", () => {
    const id = mkIdentity("夜");
    const r = rememberIdentity(id, "pw")!;
    expect(putRemembered(r)).toBe(true);
    expect(getRemembered(id.pubkey)?.pubkey).toBe(id.pubkey);
    expect(getRemembered("nope")).toBeNull();
    // 手工塞一個「明文 nsec」樣子的假 blob → isRemembered 檢查 wrapped 是 Argon2id → 拒收。
    store.set("nb.remembered.fake", JSON.stringify({ pubkey: "fake", npub: "n", name: "x", wrapped: nsecEncode(generateSecretKey()) }));
    expect(getRemembered("fake")).toBeNull();
  });
});

describe("rememberInProfile / switchActive / removeIdentity（ADR-0138）", () => {
  it("加兩個身分 → 都在登錄、作用中為最後加入；各自 blob 可解", () => {
    const a = mkIdentity("A");
    const b = mkIdentity("B");
    let s = { profiles: [], active: null } as ReturnType<typeof loadIdentities>;
    s = rememberInProfile(s, a, "pw-a", RELAY)!.state;
    s = rememberInProfile(s, b, "pw-b", RELAY)!.state;
    expect(s.profiles.map((p) => p.pubkey).sort()).toEqual([a.pubkey, b.pubkey].sort());
    expect(s.active).toBe(b.pubkey);
    expect(getRemembered(a.pubkey)?.name).toBe("A");
    expect(getRemembered(b.pubkey)?.name).toBe("B");
  });

  it("空密碼 → null（不接受無密碼記住）", () => {
    const a = mkIdentity("A");
    expect(rememberInProfile({ profiles: [], active: null }, a, "", RELAY)).toBeNull();
  });

  it("switchActive 換作用中並持久化；visibleProfiles 列出全部", () => {
    const a = mkIdentity("A");
    const b = mkIdentity("B");
    let s = rememberInProfile({ profiles: [], active: null }, a, "pw", RELAY)!.state;
    s = rememberInProfile(s, b, "pw", RELAY)!.state;
    s = switchActive(s, a.pubkey);
    expect(activeProfile(s)?.pubkey).toBe(a.pubkey);
    expect(visibleProfiles(s)).toHaveLength(2);
    // 持久化：重新載入登錄仍是 a 作用中。
    expect(loadIdentities(RELAY).active).toBe(a.pubkey);
  });

  it("removeIdentity 刪 blob＋登錄移除，作用中改指剩餘者", () => {
    const a = mkIdentity("A");
    const b = mkIdentity("B");
    let s = rememberInProfile({ profiles: [], active: null }, a, "pw", RELAY)!.state;
    s = rememberInProfile(s, b, "pw", RELAY)!.state; // active = b
    s = removeIdentity(s, b.pubkey);
    expect(s.profiles.map((p) => p.pubkey)).toEqual([a.pubkey]);
    expect(s.active).toBe(a.pubkey);
    expect(getRemembered(b.pubkey)).toBeNull(); // blob 也刪了
  });
});

describe("renameIdentity：更改顯示名稱（ADR-0144）", () => {
  it("更新登錄名稱（保留順序）＋同步記住的 blob 名稱；空白忽略", () => {
    const a = mkIdentity("A");
    const b = mkIdentity("B");
    let s = rememberInProfile({ profiles: [], active: null }, a, "pw", RELAY)!.state;
    s = rememberInProfile(s, b, "pw", RELAY)!.state; // 順序 [a, b]
    s = renameIdentity(s, a.pubkey, "  阿明  "); // 前後空白會去除
    expect(s.profiles.map((p) => p.pubkey)).toEqual([a.pubkey, b.pubkey]); // 順序不變
    expect(s.profiles.find((p) => p.pubkey === a.pubkey)?.name).toBe("阿明");
    expect(getRemembered(a.pubkey)?.name).toBe("阿明"); // blob 也更名（解鎖畫面顯示新名）
    // 空白 → 不動。
    const same = renameIdentity(s, a.pubkey, "   ");
    expect(same.profiles.find((p) => p.pubkey === a.pubkey)?.name).toBe("阿明");
    // 持久化：重載登錄仍是新名。
    expect(loadIdentities(RELAY).profiles.find((p) => p.pubkey === a.pubkey)?.name).toBe("阿明");
  });
});

describe("isOwnIdentity：跨身分交友防護（ADR-0055/0138）", () => {
  it("自己的任一身分（含非作用中）→ true；他人/亂碼 → false", () => {
    const a = mkIdentity("A");
    const b = mkIdentity("B");
    let s = rememberInProfile({ profiles: [], active: null }, a, "pw", RELAY)!.state;
    s = rememberInProfile(s, b, "pw", RELAY)!.state; // active = b；a 是非作用中身分
    expect(isOwnIdentity(s, a.npub)).toBe(true); // 非作用中身分也擋
    expect(isOwnIdentity(s, b.npub)).toBe(true); // 作用中身分
    expect(isOwnIdentity(s, npubEncode(getPublicKey(generateSecretKey())))).toBe(false); // 他人
    expect(isOwnIdentity(s, "not-an-npub")).toBe(false); // 亂碼
  });
});
