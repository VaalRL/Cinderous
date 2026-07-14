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

describe("容忍窗依對方自報的節奏（ADR-0109）", () => {
  const pk = "pk_bob";

  it("自報 5 分鐘（閒置）→ 過了 4 分鐘仍算在線（用固定短窗會誤判為離線）", () => {
    const p = new PresenceTracker();
    const t0 = 1_000_000;
    p.observe(pk, t0 / 1000, 300_000); // 閒置節奏：5 分鐘
    expect(p.statusOf(pk, t0 + 4 * 60_000)).toBe("online"); // 2.5 × 300s = 12.5 分鐘容忍
    expect(p.statusOf(pk, t0 + 13 * 60_000)).toBe("offline");
  });

  it("自報 60 秒（活躍）→ 容忍窗較短（150 秒），離線判定不會被閒置節奏拖慢", () => {
    const p = new PresenceTracker();
    const t0 = 1_000_000;
    p.observe(pk, t0 / 1000, 60_000);
    expect(p.statusOf(pk, t0 + 140_000)).toBe("online");
    expect(p.statusOf(pk, t0 + 160_000)).toBe("offline"); // 2.5 × 60s = 150s
  });

  it("未自報節奏（舊版客戶端）→ 退回預設容忍窗，不會直接判離線", () => {
    const p = new PresenceTracker();
    const t0 = 1_000_000;
    p.observe(pk, t0 / 1000); // 無 cadence
    expect(p.statusOf(pk, t0 + 10_000)).toBe("online");
  });
});
