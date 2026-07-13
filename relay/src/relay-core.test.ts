import { describe, expect, it } from "vitest";
import {
  buildAuthEvent,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type NostrEvent,
} from "@cinder/core";
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

describe("RelayCore — NIP-42 AUTH（ADR-0057）", () => {
  const AUTHMSG = (e: NostrEvent) => JSON.stringify(["AUTH", e]);
  const authCore = () => new RelayCore({ requireAuth: true, authChallenge: () => "chal-1" });

  it("connect 發出 AUTH 挑戰", () => {
    expect(authCore().connect("c")).toEqual([{ to: "c", message: ["AUTH", "chal-1"] }]);
  });

  it("未認證的 REQ 被擋並重發挑戰", () => {
    const core = authCore();
    core.connect("c");
    const out = core.handle("c", REQ("s", { kinds: [1] }));
    expect(out).toContainEqual({ to: "c", message: ["CLOSED", "s", "auth-required: 請先認證（NIP-42）"] });
    expect(out).toContainEqual({ to: "c", message: ["AUTH", "chal-1"] });
  });

  it("未認證的 EVENT 被擋", () => {
    const core = authCore();
    core.connect("c");
    const e = heartbeat();
    expect(core.handle("c", EVENT(e))).toContainEqual({
      to: "c",
      message: ["OK", e.id, false, "auth-required: 請先認證（NIP-42）"],
    });
  });

  it("正確 AUTH → 認證成功，之後（非 #p）REQ 通過", () => {
    const core = authCore();
    core.connect("c");
    const authEv = buildAuthEvent("chal-1", "wss://r", generateSecretKey());
    expect(core.handle("c", AUTHMSG(authEv))).toEqual([{ to: "c", message: ["OK", authEv.id, true, ""] }]);
    expect(core.handle("c", REQ("s", { kinds: [1] }))).toContainEqual({ to: "c", message: ["EOSE", "s"] });
  });

  it("挑戰不符的 AUTH 被拒", () => {
    const core = authCore();
    core.connect("c");
    const out = core.handle("c", AUTHMSG(buildAuthEvent("wrong", "wss://r", generateSecretKey())));
    expect(out[0]?.message[0]).toBe("OK");
    expect(out[0]?.message[2]).toBe(false);
  });

  it("#p 收件匣閘門：只能訂閱自己的 pubkey", () => {
    const core = authCore();
    core.connect("c");
    const sk = generateSecretKey();
    const self = getPublicKey(sk);
    core.handle("c", AUTHMSG(buildAuthEvent("chal-1", "wss://r", sk)));
    expect(core.handle("c", REQ("mine", { kinds: [1059], "#p": [self] }))).toContainEqual({
      to: "c",
      message: ["EOSE", "mine"],
    });
    const other = getPublicKey(generateSecretKey());
    expect(core.handle("c", REQ("other", { kinds: [1059], "#p": [other] }))).toContainEqual({
      to: "c",
      message: ["CLOSED", "other", "restricted: 只能訂閱自己的收件匣"],
    });
  });

  it("requireAuth 關（預設）：connect 不發挑戰、免認證即可讀寫", () => {
    const core = new RelayCore();
    expect(core.connect("c")).toEqual([]);
    expect(core.handle("c", REQ("s", { kinds: [20000] }))).toEqual([{ to: "c", message: ["EOSE", "s"] }]);
  });
});

describe("RelayCore — 休眠狀態還原（ADR-0059）", () => {
  const AUTHMSG = (e: NostrEvent) => JSON.stringify(["AUTH", e]);

  it("exportConn/rehydrate：喚醒後還原認證與訂閱，扇出仍正確", () => {
    const sk = generateSecretKey();
    const self = getPublicKey(sk);
    // 原 core：認證 + 掛上收件匣訂閱
    const core1 = new RelayCore({ requireAuth: true, authChallenge: () => "c1" });
    core1.connect("c");
    core1.handle("c", AUTHMSG(buildAuthEvent("c1", "wss://r", sk)));
    core1.handle("c", REQ("inbox", { kinds: [1059], "#p": [self] }));
    const snap = core1.exportConn("c");
    expect(snap.pubkey).toBe(self);
    expect(snap.subs.map((s) => s.subId)).toEqual(["inbox"]);

    // 模擬休眠喚醒：全新 core，只 rehydrate（不重連、不重認證）
    const core2 = new RelayCore({ requireAuth: true, authChallenge: () => "c2" });
    core2.rehydrate(snap);
    // 認證已還原：REQ 不被擋 → EOSE
    expect(core2.handle("c", REQ("probe", { kinds: [1] }))).toContainEqual({ to: "c", message: ["EOSE", "probe"] });
    // 訂閱已還原：另一連線發 #p:[self] 的 1059 → 扇出給還原的 "c/inbox"
    core2.connect("pub");
    core2.handle("pub", AUTHMSG(buildAuthEvent("c2", "wss://r", generateSecretKey())));
    const pubEv = finalizeEvent({ kind: 1059, created_at: 1700000000, tags: [["p", self]], content: "x" }, generateSecretKey());
    expect(core2.handle("pub", EVENT(pubEv))).toContainEqual({ to: "c", message: ["EVENT", "inbox", pubEv] });
  });

  it("未認證連線的挑戰也隨快照還原（喚醒後仍能完成認證）", () => {
    const core1 = new RelayCore({ requireAuth: true, authChallenge: () => "chal-x" });
    core1.connect("c");
    const snap = core1.exportConn("c");
    expect(snap.challenge).toBe("chal-x");
    expect(snap.pubkey).toBeUndefined();

    const core2 = new RelayCore({ requireAuth: true, authChallenge: () => "other" });
    core2.rehydrate(snap);
    // 用還原的挑戰認證 → 成功
    const sk = generateSecretKey();
    const out = core2.handle("c", AUTHMSG(buildAuthEvent("chal-x", "wss://r", sk)));
    expect(out[0]?.message[2]).toBe(true);
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

describe("RelayCore — 可尋址快照（NIP-33，ADR-0071）", () => {
  const AUTHMSG = (e: NostrEvent) => JSON.stringify(["AUTH", e]);
  const snapshot = (sk: Uint8Array, opts: { d?: string; content?: string; createdAt?: number } = {}): NostrEvent =>
    finalizeEvent(
      {
        kind: 30078,
        created_at: opts.createdAt ?? 1_700_000_000,
        tags: [["d", opts.d ?? "dev1"]],
        content: opts.content ?? "密文快照",
      },
      sk,
    );

  it("發佈→取代→purge：REQ 永遠只看到最新一顆；purge 後查無", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 1_700_000_000 });
    core.connect("c");
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);

    const v1 = snapshot(sk, { createdAt: 1_700_000_000, content: "v1" });
    const v2 = snapshot(sk, { createdAt: 1_700_000_100, content: "v2" });
    expect(core.handle("c", EVENT(v1))).toContainEqual({ to: "c", message: ["OK", v1.id, true, ""] });
    expect(core.handle("c", EVENT(v2))).toContainEqual({ to: "c", message: ["OK", v2.id, true, ""] });

    const replay = core.handle("c", REQ("s", { kinds: [30078], authors: [pk] }));
    const events = replay.filter((o) => o.message[0] === "EVENT");
    expect(events).toHaveLength(1);
    expect((events[0]!.message[2] as NostrEvent).content).toBe("v2");

    const purge = snapshot(sk, { createdAt: 1_700_000_200, content: "" });
    expect(core.handle("c", EVENT(purge))).toContainEqual({ to: "c", message: ["OK", purge.id, true, ""] });
    const after = core.handle("c", REQ("s2", { kinds: [30078], authors: [pk] }));
    expect(after.filter((o) => o.message[0] === "EVENT")).toHaveLength(0);
  });

  it("配額超限回 OK false（第 6 個 d）", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 1_700_000_000 });
    core.connect("c");
    const sk = generateSecretKey();
    for (let i = 1; i <= 5; i++) {
      const e = snapshot(sk, { d: `dev${i}` });
      expect(core.handle("c", EVENT(e))).toContainEqual({ to: "c", message: ["OK", e.id, true, ""] });
    }
    const sixth = snapshot(sk, { d: "dev6" });
    expect(core.handle("c", EVENT(sixth))).toContainEqual({
      to: "c",
      message: ["OK", sixth.id, false, "blocked: 取代事件遭拒（配額/大小/較舊）"],
    });
  });

  it("requireAuth：他人讀不到我的快照——REQ 重放與即時扇出皆閘門，本人可讀", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 1_700_000_000, requireAuth: true, authChallenge: () => "ch" });
    const aliceSk = generateSecretKey();
    const alicePk = getPublicKey(aliceSk);
    const bobSk = generateSecretKey();

    core.connect("alice");
    core.handle("alice", AUTHMSG(buildAuthEvent("ch", "wss://r", aliceSk)));
    core.connect("bob");
    core.handle("bob", AUTHMSG(buildAuthEvent("ch", "wss://r", bobSk)));

    // Bob 先掛萬用訂閱（會匹配任何 kind）——即時扇出不得把 Alice 的快照送給他
    core.handle("bob", REQ("spy", {}));
    const snap = snapshot(aliceSk);
    const out = core.handle("alice", EVENT(snap));
    expect(out.some((o) => o.to === "bob")).toBe(false);

    // Bob 的 REQ 重放也拿不到（即使 filter 直指 Alice）
    const replay = core.handle("bob", REQ("s", { kinds: [30078], authors: [alicePk] }));
    expect(replay.filter((o) => o.message[0] === "EVENT")).toHaveLength(0);

    // Alice 本人可讀回
    const mine = core.handle("alice", REQ("m", { kinds: [30078], authors: [alicePk] }));
    expect(mine.filter((o) => o.message[0] === "EVENT")).toHaveLength(1);
  });
});

describe("RelayCore — 可取代事件（NIP-01，ADR-0035）", () => {
  const maintainerSk = generateSecretKey();
  const maintainer = getPublicKey(maintainerSk);
  const list = (createdAt: number, content: string): NostrEvent =>
    finalizeEvent({ kind: 10037, created_at: createdAt, tags: [], content }, maintainerSk);

  it("cron 連發 relay 清單只留最新一顆；新客戶端 REQ 只收到一份（不再下載上百份重複）", () => {
    const core = new RelayCore({ store: new MessageStore() });
    core.connect("pub");
    for (let h = 0; h < 24; h += 1) core.handle("pub", JSON.stringify(["EVENT", list(1000 + h * 3600, `v${h}`)]));

    core.connect("client");
    const out = core.handle("client", JSON.stringify(["REQ", "relaylist", { kinds: [10037], authors: [maintainer] }]));
    const events = out.filter((o) => o.message[0] === "EVENT");
    expect(events.length).toBe(1); // ← 修好的行為（過去會是 24）
    expect((events[0]!.message[2] as NostrEvent).content).toBe("v23");
  });

  it("可取代事件是**公開**的：不像快照被限制只回作者本人（清單必須人人收得到）", () => {
    const core = new RelayCore({ store: new MessageStore() });
    core.connect("pub");
    core.connect("sub");
    // 別人先訂閱，維護者才發佈 → 即時扇出應送達訂閱者（非作者）。
    core.handle("sub", JSON.stringify(["REQ", "rl", { kinds: [10037] }]));
    const out = core.handle("pub", JSON.stringify(["EVENT", list(2000, "public")]));
    expect(out.some((o) => o.to === "sub" && o.message[0] === "EVENT")).toBe(true);
  });
});
