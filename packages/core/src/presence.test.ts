import { describe, expect, it } from "vitest";
import { KIND, OFFLINE_TIMEOUT_MS } from "./constants.js";
import { buildPresenceFilter, PresenceTracker } from "./presence.js";

const PK = "ab".repeat(32);

describe("訂閱 filter", () => {
  it("依好友 pubkey 建構心跳訂閱 filter", () => {
    expect(buildPresenceFilter([PK])).toEqual({ kinds: [KIND.HEARTBEAT], authors: [PK] });
  });
});

describe("上線/離線判定（30s 心跳，60s 判離線）", () => {
  it("從未收到心跳者為離線", () => {
    const t = new PresenceTracker();
    expect(t.statusOf(PK, Date.now())).toBe("offline");
  });

  it("收到心跳後、未逾時為上線", () => {
    const t = new PresenceTracker();
    const nowSec = 1_700_000_000;
    t.observe(PK, nowSec);
    const now = nowSec * 1000;
    expect(t.statusOf(PK, now)).toBe("online");
    expect(t.statusOf(PK, now + OFFLINE_TIMEOUT_MS)).toBe("online");
  });

  it("超過離線門檻判定為離線", () => {
    const t = new PresenceTracker();
    const nowSec = 1_700_000_000;
    t.observe(PK, nowSec);
    expect(t.statusOf(PK, nowSec * 1000 + OFFLINE_TIMEOUT_MS + 1)).toBe("offline");
  });

  it("較新的心跳更新 lastSeen，亂序較舊心跳不回退", () => {
    const t = new PresenceTracker();
    t.observe(PK, 1000);
    t.observe(PK, 900); // 較舊，應忽略
    expect(t.lastSeenAt(PK)).toBe(1000 * 1000);
    t.observe(PK, 1100);
    expect(t.lastSeenAt(PK)).toBe(1100 * 1000);
  });
});
