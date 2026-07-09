import { generateSecretKey, getPublicKey, nsecEncode } from "@cinder/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeProfile,
  changeProfileRelay,
  loadProfiles,
  type Profile,
  type ProfilesState,
  removeProfile,
  saveProfiles,
  setActive,
  upsertProfile,
} from "./profiles.js";

const mk = (pubkey: string, over: Partial<Profile> = {}): Profile => ({
  pubkey,
  name: pubkey,
  relayUrl: "wss://r",
  enterprise: false,
  namespace: pubkey,
  ...over,
});

const empty: ProfilesState = { profiles: [], active: null };

describe("profiles 純登錄（ADR-0045）", () => {
  it("upsert：新增並設為作用中；同 pubkey 更新不重複", () => {
    let s = upsertProfile(empty, mk("a"));
    expect(s.active).toBe("a");
    s = upsertProfile(s, mk("b"));
    expect(s.active).toBe("b");
    expect(s.profiles.map((p) => p.pubkey)).toEqual(["a", "b"]);
    s = upsertProfile(s, mk("a", { name: "改名" }));
    expect(s.profiles.length).toBe(2);
    expect(s.profiles.find((p) => p.pubkey === "a")?.name).toBe("改名");
    expect(s.active).toBe("a");
  });

  it("remove：移除作用中時改指剩餘第一個", () => {
    let s = upsertProfile(upsertProfile(empty, mk("a")), mk("b")); // active=b
    s = removeProfile(s, "b");
    expect(s.active).toBe("a");
    s = removeProfile(s, "a");
    expect(s).toEqual({ profiles: [], active: null });
  });

  it("setActive：未知 pubkey 不變", () => {
    const s = upsertProfile(empty, mk("a"));
    expect(setActive(s, "zzz")).toBe(s);
    expect(setActive(s, "a").active).toBe("a");
  });

  it("activeProfile", () => {
    const s = upsertProfile(empty, mk("a"));
    expect(activeProfile(s)?.pubkey).toBe("a");
    expect(activeProfile(empty)).toBeNull();
  });

  it("changeProfileRelay（ADR-0066 H2）：只改 relayUrl，其餘欄位與 active 全保留；未知 pubkey 不變", () => {
    const legacy = mk("a", { namespace: "", name: "我", adminPubkey: "admin" });
    const s0 = setActive(upsertProfile(upsertProfile(empty, legacy), mk("b")), "a");
    const s1 = changeProfileRelay(s0, "a", "wss://new");
    expect(s1.profiles.find((x) => x.pubkey === "a")).toEqual({ ...legacy, relayUrl: "wss://new" });
    expect(s1.active).toBe("a"); // 作用中不變（搬家非切換身分）
    expect(s1.profiles.find((x) => x.pubkey === "b")?.relayUrl).toBe("wss://r"); // 他人不受影響
    expect(changeProfileRelay(s1, "zzz", "wss://x")).toBe(s1);
  });
});

describe("profiles 持久化與遷移", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it("往返保存", () => {
    const s = upsertProfile(empty, mk("a"));
    saveProfiles(s);
    expect(loadProfiles()).toEqual(s);
  });

  it("首次載入把既有單一身分遷移為 legacy（namespace 空）設定檔", () => {
    const sk = generateSecretKey();
    const pub = getPublicKey(sk);
    localStorage.setItem("nb.identity", JSON.stringify({ nsec: nsecEncode(sk), name: "我" }));
    localStorage.setItem("nb.relayUrl", "wss://home");
    const s = loadProfiles();
    expect(s.active).toBe(pub);
    expect(s.profiles).toEqual([
      { pubkey: pub, name: "我", relayUrl: "wss://home", enterprise: false, namespace: "" },
    ]);
    // 已持久化：再次載入不重新遷移
    expect(loadProfiles()).toEqual(s);
  });

  it("無任何身分時回空", () => {
    expect(loadProfiles()).toEqual({ profiles: [], active: null });
  });
});
