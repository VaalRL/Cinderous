import { generateSecretKey, getPublicKey, npubEncode, nsecEncode } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import type { MobileIdentity } from "./auth.js";
import { ANCHOR_RELAYS } from "@cinderous/engine";
import { createBackend, DEFAULT_RELAY } from "./backend.js";

function identity(name = "我"): MobileIdentity {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { sk, pubkey, npub: npubEncode(pubkey), nsec: nsecEncode(sk), name };
}

describe("行動端後端選擇（ADR-0086）", () => {
  it("無 relayUrl → 示範後端（記憶體＋機器人），self 名沿用身分名", () => {
    const backend = createBackend(identity("阿夜"), null);
    expect(backend.self.name).toBe("阿夜");
    backend.stop();
  });

  it("有 relayUrl → 真實 relay 後端，身分由 nsec 導出（同帳號、不連線僅建構）", () => {
    const id = identity();
    const backend = createBackend(id, "wss://relay.example");
    expect(backend.self.pubkey).toBe(id.pubkey);
    expect(backend.selfNpub).toBe(id.npub);
    expect(backend.self.name).toBe("我");
    backend.stop();
  });

  it("DEFAULT_RELAY 為 wss:// 生產中繼站", () => {
    expect(DEFAULT_RELAY).toMatch(/^wss:\/\//);
  });
});

describe("行動端後端接線補齊（ADR-0100）", () => {
  it("錨點：不再只綁使用者那一座——ANCHOR_RELAYS 一併帶入保底且去重", () => {
    const anchor = ANCHOR_RELAYS[0]!;
    // 使用者就用錨點那座 → 去重後不重複
    expect([...new Set([anchor, ...ANCHOR_RELAYS])].length).toBe(ANCHOR_RELAYS.length);
    // 使用者自架 → 自己那座優先，錨點在後保底
    const custom = [...new Set(["wss://my-own", ...ANCHOR_RELAYS])];
    expect(custom[0]).toBe("wss://my-own");
    expect(custom).toContain(anchor);
  });

  it("真實 relay 後端：具備檔案傳輸與雲端快照能力（過去行動端兩者皆無）", () => {
    const backend = createBackend(identity(), "wss://relay.example", { cloudSync: "full" });
    expect(typeof backend.sendFile).toBe("function"); // ADR-0093 檔案
    expect(typeof backend.publishSnapshotNow).toBe("function"); // ADR-0071 雲端備份
    expect(typeof backend.purgeCloudSnapshot).toBe("function");
    backend.stop();
  });

  it("示範模式：無 P2P 檔案傳輸（不誤顯示 📎）", () => {
    const backend = createBackend(identity(), null);
    expect(backend.sendFile).toBeUndefined();
    backend.stop();
  });
});

describe("行動端上線狀態本機還原（ADR-0168）", () => {
  it("帶入 initialStatus／initialStatusMessage → self 依此建構（首次心跳即照此廣播）", () => {
    const backend = createBackend(identity(), "wss://relay.example", {
      initialStatus: "busy",
      initialStatusMessage: "趕稿中",
    });
    expect(backend.self.status).toBe("busy");
    expect(backend.self.statusMessage).toBe("趕稿中");
    backend.stop();
  });

  it("未帶 initial → 預設 online、空文字（不因缺省而洩漏舊狀態）", () => {
    const backend = createBackend(identity(), "wss://relay.example");
    expect(backend.self.status).toBe("online");
    expect(backend.self.statusMessage).toBe("");
    backend.stop();
  });
});

describe("行動端企業身分後端接線（ADR-0173）", () => {
  // 名冊採用/allowlist 的實際行為由 engine relay-backend.test.ts 把關；此處確保行動端把配對搬來的
  // org 精華透傳給後端建構、不因新選項而炸（orgAdminPubkey 型別對齊由 typecheck 保證）。
  it("帶 org（企業成員）→ 後端正常建構、身分不變（唯讀採用公司名冊）", () => {
    const id = identity();
    const backend = createBackend(id, "wss://company.relay", {
      org: { enterprise: true, adminPubkey: "b".repeat(64), orgJoinToken: "tok" },
    });
    expect(backend.self.pubkey).toBe(id.pubkey);
    backend.stop();
  });

  it("示範模式（無 relay）帶 org 也不炸（org 在示範後端無意義、被忽略）", () => {
    const backend = createBackend(identity(), null, { org: { orgOwner: true } });
    expect(backend.self.name).toBeTruthy();
    backend.stop();
  });
});

