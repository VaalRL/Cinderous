import { generateSecretKey, getPublicKey, nsecEncode } from "@cinderous/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeDrain,
  activeProfile,
  adoptCloudSyncMode,
  changeProfileRelay,
  clearDrain,
  DRAIN_MS,
  loadProfiles,
  type Profile,
  type ProfilesState,
  removeProfile,
  saveProfiles,
  setActive,
  nameTaken,
  resolveSignIn,
  setProfileCloudSync,
  setProfileSecurity,
  upsertProfile,
  visibleProfiles,
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
    const s1 = changeProfileRelay(s0, "a", "wss://new", { now: 1000 });
    expect(s1.profiles.find((x) => x.pubkey === "a")).toEqual({
      ...legacy,
      relayUrl: "wss://new",
      previousRelayUrl: "wss://r", // H3：舊站記入排水
      drainUntil: 1000 + DRAIN_MS,
    });
    expect(s1.active).toBe("a"); // 作用中不變（搬家非切換身分）
    expect(s1.profiles.find((x) => x.pubkey === "b")?.relayUrl).toBe("wss://r"); // 他人不受影響
    expect(changeProfileRelay(s1, "zzz", "wss://x")).toBe(s1);
  });

  it("排水（ADR-0066 H3）：activeDrain 未到期回舊站資訊、到期/無排水回 null；clearDrain 提前完成", () => {
    const s0 = setActive(upsertProfile(empty, mk("a")), "a");
    const s1 = changeProfileRelay(s0, "a", "wss://new", { now: 1000 });
    const p1 = activeProfile(s1)!;
    expect(activeDrain(p1, 1000 + DRAIN_MS - 1)).toEqual({ url: "wss://r", until: 1000 + DRAIN_MS });
    expect(activeDrain(p1, 1000 + DRAIN_MS)).toBeNull(); // 到期自動停
    expect(activeDrain(mk("x"), 0)).toBeNull(); // 從未搬家
    expect(activeDrain(null, 0)).toBeNull();

    const s2 = clearDrain(s1, "a");
    const p2 = activeProfile(s2)!;
    expect(p2.previousRelayUrl).toBeUndefined();
    expect(p2.drainUntil).toBeUndefined();
    expect(p2.relayUrl).toBe("wss://new"); // 其餘不動
    expect(activeDrain(p2, 1001)).toBeNull();
  });

  it("排水期間再搬一次：previousRelayUrl 換成上一站、drainUntil 重置（單槽排水）", () => {
    const s0 = setActive(upsertProfile(empty, mk("a")), "a");
    const s1 = changeProfileRelay(s0, "a", "wss://b", { now: 1000 });
    const s2 = changeProfileRelay(s1, "a", "wss://c", { now: 2000 });
    const p = activeProfile(s2)!;
    expect(p.previousRelayUrl).toBe("wss://b");
    expect(p.drainUntil).toBe(2000 + DRAIN_MS);
  });

  it("本地密碼旗標（ADR-0067）：setProfileSecurity 更新 locked/hidden，其餘不動；未知 pubkey 不變", () => {
    const s0 = setActive(upsertProfile(empty, mk("a", { name: "我" })), "a");
    const s1 = setProfileSecurity(s0, "a", { locked: true, hidden: true });
    expect(activeProfile(s1)).toEqual({ ...mk("a", { name: "我" }), locked: true, hidden: true });
    const s2 = setProfileSecurity(s1, "a", { hidden: false });
    expect(activeProfile(s2)?.locked).toBe(true); // 未指定的旗標不動
    expect(activeProfile(s2)?.hidden).toBe(false);
    expect(setProfileSecurity(s2, "zzz", { locked: true })).toBe(s2);
  });

  it("visibleProfiles（ADR-0067 隱藏身分）：過濾 hidden，但作用中即使 hidden 也顯示", () => {
    let s = upsertProfile(upsertProfile(upsertProfile(empty, mk("a")), mk("b", { hidden: true })), mk("c"));
    s = setActive(s, "c");
    expect(visibleProfiles(s).map((p) => p.pubkey)).toEqual(["a", "c"]);
    s = setActive(s, "b"); // 正在使用隱藏身分：本人看得到自己
    expect(visibleProfiles(s).map((p) => p.pubkey)).toEqual(["a", "b", "c"]);
  });

  it("setProfileCloudSync（ADR-0071）：設定三檔模式、其餘不動；未知 pubkey 不變", () => {
    const s0 = setActive(upsertProfile(empty, mk("a")), "a");
    const s1 = setProfileCloudSync(s0, "a", "full");
    expect(activeProfile(s1)?.cloudSync).toBe("full");
    expect(activeProfile(s1)?.relayUrl).toBe("wss://r");
    expect(setProfileCloudSync(s1, "zzz", "off")).toBe(s1);
    expect(activeProfile(setProfileCloudSync(s1, "a", "off"))?.cloudSync).toBe("off");
  });

  it("adoptCloudSyncMode（審查修正 #1）：僅本機從未設定時採用快照模式；已設定（含 off）不覆蓋", () => {
    const fresh = setActive(upsertProfile(empty, mk("a")), "a");
    expect(activeProfile(adoptCloudSyncMode(fresh, "a", "full"))?.cloudSync).toBe("full");
    const userOff = setProfileCloudSync(fresh, "a", "off");
    expect(adoptCloudSyncMode(userOff, "a", "full")).toBe(userOff); // 使用者明確關閉：不覆蓋
    const userBasic = setProfileCloudSync(fresh, "a", "basic");
    expect(activeProfile(adoptCloudSyncMode(userBasic, "a", "full"))?.cloudSync).toBe("basic");
    expect(adoptCloudSyncMode(fresh, "zzz", "full")).toBe(fresh);
  });
});

describe("resolveSignIn（ADR-0146：登入以顯示名稱解析既有身分）", () => {
  it("無命中 → create（建新身分）；空白名亦視為 create", () => {
    const s = upsertProfile(empty, mk("a", { name: "小明" }));
    expect(resolveSignIn(s, "小華")).toEqual({ kind: "create" });
    expect(resolveSignIn(s, "   ").kind).toBe("create");
    expect(resolveSignIn(empty, "任何").kind).toBe("create");
  });

  it("恰一個可見同名 → enter 該身分（trim 比對）", () => {
    const s = upsertProfile(upsertProfile(empty, mk("a", { name: "小明" })), mk("b", { name: "工作" }));
    const r = resolveSignIn(s, "  工作 ");
    expect(r.kind).toBe("enter");
    expect(r.kind === "enter" && r.profile.pubkey).toBe("b");
  });

  it("🔴 隱藏身分永不被名稱命中（維持 ADR-0067 隱藏性）", () => {
    const s = upsertProfile(empty, mk("a", { name: "祕密", hidden: true }));
    expect(resolveSignIn(s, "祕密")).toEqual({ kind: "create" });
    // 可見同名存在時，只命中可見那個（隱藏的不參與）
    const s2 = upsertProfile(s, mk("b", { name: "祕密" }));
    const r = resolveSignIn(s2, "祕密");
    expect(r.kind === "enter" && r.profile.pubkey).toBe("b");
  });

  it("多個可見同名（僅可能來自舊資料）→ ambiguous，不靜默進入", () => {
    const s = upsertProfile(upsertProfile(empty, mk("a", { name: "重複" })), mk("b", { name: "重複" }));
    const r = resolveSignIn(s, "重複");
    expect(r.kind).toBe("ambiguous");
    expect(r.kind === "ambiguous" && r.profiles.map((p) => p.pubkey)).toEqual(["a", "b"]);
  });
});

describe("nameTaken（ADR-0146：本機可見身分名稱唯一）", () => {
  it("可見同名 → 被佔用；不同名 → 未佔用（trim 比對）", () => {
    const s = upsertProfile(empty, mk("a", { name: "工作" }));
    expect(nameTaken(s, " 工作 ")).toBe(true);
    expect(nameTaken(s, "個人")).toBe(false);
    expect(nameTaken(s, "   ")).toBe(false);
  });

  it("排除自己（改名情境）：改回同名不算佔用", () => {
    const s = upsertProfile(upsertProfile(empty, mk("a", { name: "工作" })), mk("b", { name: "個人" }));
    expect(nameTaken(s, "工作", "a")).toBe(false); // a 改成自己的名字
    expect(nameTaken(s, "工作", "b")).toBe(true); // b 想改成已被 a 佔用的名字
  });

  it("🔴 隱藏身分不佔名：不因『名稱被佔用』洩漏隱藏身分存在", () => {
    const s = upsertProfile(empty, mk("a", { name: "祕密", hidden: true }));
    expect(nameTaken(s, "祕密")).toBe(false);
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
