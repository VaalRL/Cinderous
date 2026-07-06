import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type NostrEvent,
} from "@nostr-buddy/core";
import { MessageStore } from "./message-store.js";
import { leadingZeroBits, RelayCore } from "./relay-core.js";

function heartbeat(): NostrEvent {
  return finalizeEvent(
    { kind: 20000, created_at: 1700000000, tags: [], content: "" },
    generateSecretKey(),
  );
}

const REQ = (sub: string, filter: object) => JSON.stringify(["REQ", sub, filter]);
const EVENT = (e: NostrEvent) => JSON.stringify(["EVENT", e]);

describe("RelayCore — 訂閱與 Ephemeral 轉發", () => {
  it("REQ 立即回 EOSE（M1 無歷史事件）", () => {
    const core = new RelayCore();
    core.connect("c1");
    const out = core.handle("c1", REQ("s1", { kinds: [20000] }));
    expect(out).toEqual([{ to: "c1", message: ["EOSE", "s1"] }]);
  });

  it("心跳事件扇出給符合 filter 的其他連線，並回 OK 給發送者", () => {
    const core = new RelayCore();
    core.connect("sender");
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));

    const e = heartbeat();
    const out = core.handle("sender", EVENT(e));

    expect(out).toContainEqual({ to: "sender", message: ["OK", e.id, true, ""] });
    expect(out).toContainEqual({ to: "watcher", message: ["EVENT", "s1", e] });
  });

  it("不符 filter（kinds 不同）不轉發", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [1] }));
    const out = core.handle("sender", EVENT(heartbeat()));
    expect(out.some((o) => o.to === "watcher")).toBe(false);
  });

  it("簽章無效的事件回 OK=false 且不轉發", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));
    const e = heartbeat();
    const out = core.handle("sender", EVENT({ ...e, content: "tampered" }));
    expect(out).toEqual([
      { to: "sender", message: ["OK", e.id, false, "invalid: 簽章驗證失敗"] },
    ]);
  });

  it("Ephemeral（20000-29999）絕不寫入持久層", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 0 });
    core.connect("sender");
    core.handle("sender", EVENT(heartbeat()));
    expect(store.query({ kinds: [20000] }, 0)).toEqual([]);
  });

  it("非 Ephemeral 事件才會寫入持久層", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 0 });
    core.connect("sender");
    const e = finalizeEvent(
      { kind: 1, created_at: 1700000000, tags: [], content: "hi" },
      generateSecretKey(),
    );
    core.handle("sender", EVENT(e));
    expect(store.query({ kinds: [1] }, 0)).toEqual([e]);
  });

  it("REQ 會回放符合的歷史留言，最後送 EOSE", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 100 });
    const to = getPublicKey(generateSecretKey());
    const dm = finalizeEvent(
      { kind: 1059, created_at: 100, tags: [["p", to]], content: "x" },
      generateSecretKey(),
    );
    core.connect("sender");
    core.handle("sender", EVENT(dm));

    core.connect("reader");
    const out = core.handle("reader", REQ("s1", { kinds: [1059], "#p": [to] }));
    expect(out).toEqual([
      { to: "reader", message: ["EVENT", "s1", dm] },
      { to: "reader", message: ["EOSE", "s1"] },
    ]);
  });

  it("CLOSE 後不再收到轉發", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));
    core.handle("watcher", JSON.stringify(["CLOSE", "s1"]));
    const out = core.handle("sender", EVENT(heartbeat()));
    expect(out.some((o) => o.to === "watcher")).toBe(false);
  });

  it("斷線會清除其訂閱", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));
    core.disconnect("watcher");
    const out = core.handle("sender", EVENT(heartbeat()));
    expect(out.some((o) => o.to === "watcher")).toBe(false);
  });
});

describe("leadingZeroBits（NIP-13）", () => {
  it("計算 hex 開頭零位元數", () => {
    expect(leadingZeroBits("ffff")).toBe(0);
    expect(leadingZeroBits("0fff")).toBe(4);
    expect(leadingZeroBits("00ff")).toBe(8);
    expect(leadingZeroBits("1fff")).toBe(3);
    expect(leadingZeroBits("002f")).toBe(10);
  });
});

describe("RelayCore — 防濫用（C1）", () => {
  function dmEvent(target: string, createdAt: number) {
    return finalizeEvent(
      { kind: 1059, created_at: createdAt, tags: [["p", target]], content: "x" },
      generateSecretKey(),
    );
  }
  function mine(target: string, difficulty: number) {
    const sk = generateSecretKey();
    for (let t = 0; ; t++) {
      const e = finalizeEvent({ kind: 1059, created_at: t, tags: [["p", target]], content: "" }, sk);
      if (leadingZeroBits(e.id) >= difficulty) return e;
    }
  }

  it("超過每連線訂閱數上限時拒絕新訂閱，替換既有 subId 仍可", () => {
    const core = new RelayCore({ maxSubscriptions: 1 });
    core.connect("c");
    expect(core.handle("c", REQ("s1", { kinds: [20000] }))).toContainEqual({
      to: "c",
      message: ["EOSE", "s1"],
    });
    const rejected = core.handle("c", REQ("s2", { kinds: [20000] }));
    expect(rejected[0]?.message[0]).toBe("CLOSED");
    expect(String(rejected[0]?.message[2])).toContain("上限");
    // 替換同一 subId 不算新增
    expect(core.handle("c", REQ("s1", { kinds: [1] }))).toContainEqual({
      to: "c",
      message: ["EOSE", "s1"],
    });
  });

  it("PoW 難度不足的持久化事件被拒", () => {
    const core = new RelayCore({ minPowDifficulty: 20 });
    const pk = getPublicKey(generateSecretKey());
    const out = core.handle("c", EVENT(dmEvent(pk, 1)));
    expect(out[0]?.message[0]).toBe("OK");
    expect(out[0]?.message[2]).toBe(false);
    expect(String(out[0]?.message[3])).toContain("pow");
  });

  it("PoW 達標的持久化事件被接受", () => {
    const core = new RelayCore({ minPowDifficulty: 8 });
    const pk = getPublicKey(generateSecretKey());
    const out = core.handle("c", EVENT(mine(pk, 8)));
    expect(out[0]?.message[2]).toBe(true);
  });

  it("Ephemeral 事件不受 PoW 限制", () => {
    const core = new RelayCore({ minPowDifficulty: 20 });
    const out = core.handle("c", EVENT(heartbeat()));
    expect(out[0]?.message[2]).toBe(true);
  });
});

describe("RelayCore — 時鐘偏移與重放防護（C2）", () => {
  const hb = (createdAt: number) =>
    finalizeEvent({ kind: 20000, created_at: createdAt, tags: [], content: "" }, generateSecretKey());

  it("created_at 偏離本機時鐘過大時拒收", () => {
    const core = new RelayCore({ maxClockSkewSec: 60, now: () => 1000 });
    const out = core.handle("c", EVENT(hb(5000)));
    expect(out[0]?.message[2]).toBe(false);
    expect(String(out[0]?.message[3])).toContain("時間戳");
  });

  it("時鐘窗內、唯一事件被接受", () => {
    const core = new RelayCore({ maxClockSkewSec: 60, now: () => 1000 });
    expect(core.handle("c", EVENT(hb(1000)))[0]?.message[2]).toBe(true);
  });

  it("重放相同事件被去重拒絕", () => {
    const core = new RelayCore({ maxClockSkewSec: 60, now: () => 1000 });
    const e = hb(1000);
    expect(core.handle("c", EVENT(e))[0]?.message[2]).toBe(true);
    const replay = core.handle("c", EVENT(e));
    expect(replay[0]?.message[2]).toBe(false);
    expect(String(replay[0]?.message[3])).toContain("duplicate");
  });

  it("未設定 maxClockSkewSec 時不啟用（維持原行為）", () => {
    const core = new RelayCore({ now: () => 1000 });
    const e = hb(99999);
    expect(core.handle("c", EVENT(e))[0]?.message[2]).toBe(true);
    expect(core.handle("c", EVENT(e))[0]?.message[2]).toBe(true);
  });
});

describe("RelayCore — 企業封閉模式 allowlist（ADR-0044）", () => {
  const signedHb = (sk: Uint8Array): NostrEvent =>
    finalizeEvent({ kind: 20000, created_at: 1700000000, tags: [], content: "" }, sk);

  it("名單內成員可發布並扇出；名單外成員一律拒收（含心跳）", () => {
    const memberSk = generateSecretKey();
    const outsiderSk = generateSecretKey();
    const member = getPublicKey(memberSk);
    const core = new RelayCore({ allowedAuthors: [member] });
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));

    const good = signedHb(memberSk);
    const goodOut = core.handle("member", EVENT(good));
    expect(goodOut).toContainEqual({ to: "member", message: ["OK", good.id, true, ""] });
    expect(goodOut).toContainEqual({ to: "watcher", message: ["EVENT", "s1", good] });

    const bad = signedHb(outsiderSk);
    const badOut = core.handle("outsider", EVENT(bad));
    expect(badOut[0]?.message[2]).toBe(false);
    expect(String(badOut[0]?.message[3])).toContain("blocked");
    // 非成員的事件不扇出給任何訂閱者
    expect(badOut.some((o) => o.to === "watcher")).toBe(false);
  });

  it("未設定 allowedAuthors 時為開放中繼（維持原行為）", () => {
    const core = new RelayCore();
    const e = signedHb(generateSecretKey());
    expect(core.handle("c", EVENT(e))[0]?.message[2]).toBe(true);
  });
});

describe("RelayCore — 企業政策 allowedKinds（ADR-0048）", () => {
  const signedHb = (sk: Uint8Array): NostrEvent =>
    finalizeEvent({ kind: 20000, created_at: 1700000000, tags: [], content: "" }, sk);
  const signedKind = (sk: Uint8Array, kind: number): NostrEvent =>
    finalizeEvent({ kind, created_at: 1700000000, tags: [], content: "" }, sk);

  it("允許名單內 kind 通過、名單外拒收", () => {
    const core = new RelayCore({ allowedKinds: [20000] });
    const sk = generateSecretKey();
    expect(core.handle("c", EVENT(signedHb(sk)))[0]?.message[2]).toBe(true);
    const dropped = core.handle("c", EVENT(signedKind(sk, 21000))); // 信令 kind 被政策擋
    expect(dropped[0]?.message[2]).toBe(false);
    expect(String(dropped[0]?.message[3])).toContain("blocked");
  });

  it("未設 allowedKinds 時不限制", () => {
    const core = new RelayCore();
    expect(core.handle("c", EVENT(signedKind(generateSecretKey(), 21000)))[0]?.message[2]).toBe(true);
  });
});
