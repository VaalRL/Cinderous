import { describe, expect, it } from "vitest";
import { DEFAULT_IDLE_MS, initIdle, reduceIdle } from "./idle-status.js";

describe("閒置自動離開狀態機", () => {
  it("online 逾時 → 自動切 away", () => {
    const s0 = initIdle(0, "online");
    const r = reduceIdle(s0, { type: "tick", at: DEFAULT_IDLE_MS });
    expect(r.setStatus).toBe("away");
    expect(r.state.auto).toBe(true);
  });

  it("未達門檻不觸發", () => {
    const s0 = initIdle(0, "online");
    const r = reduceIdle(s0, { type: "tick", at: DEFAULT_IDLE_MS - 1 });
    expect(r.setStatus).toBeNull();
    expect(r.state.auto).toBe(false);
  });

  it("自動離開後偵測到活動 → 還原成手動狀態並清除 auto", () => {
    let s = initIdle(0, "online");
    s = reduceIdle(s, { type: "tick", at: DEFAULT_IDLE_MS }).state; // 進入 auto-away
    expect(s.auto).toBe(true);
    const r = reduceIdle(s, { type: "activity", at: DEFAULT_IDLE_MS + 10 });
    expect(r.setStatus).toBe("online");
    expect(r.state.auto).toBe(false);
  });

  it("活動只更新時間、非自動離開時不改狀態", () => {
    const s0 = initIdle(0, "online");
    const r = reduceIdle(s0, { type: "activity", at: 5_000 });
    expect(r.setStatus).toBeNull();
    expect(r.state.lastActivity).toBe(5_000);
  });

  it("手動 busy 不會被閒置覆蓋為 away", () => {
    let s = initIdle(0, "online");
    s = reduceIdle(s, { type: "manual", status: "busy", at: 1_000 }).state;
    const r = reduceIdle(s, { type: "tick", at: 1_000 + DEFAULT_IDLE_MS });
    expect(r.setStatus).toBeNull();
    expect(r.state.auto).toBe(false);
  });

  it("手動事件重設活動時間且不重複 setStatus", () => {
    const s0 = initIdle(0, "online");
    const r = reduceIdle(s0, { type: "manual", status: "away", at: 2_000 });
    expect(r.setStatus).toBeNull();
    expect(r.state.manual).toBe("away");
    expect(r.state.lastActivity).toBe(2_000);
  });

  it("自訂門檻可調", () => {
    const s0 = initIdle(0, "online");
    expect(reduceIdle(s0, { type: "tick", at: 1_000 }, 1_000).setStatus).toBe("away");
  });

  it("不會對已 away／offline 的手動狀態再自動離開", () => {
    for (const manual of ["away", "offline"] as const) {
      const s = { manual, auto: false, lastActivity: 0 };
      expect(reduceIdle(s, { type: "tick", at: DEFAULT_IDLE_MS }).setStatus).toBeNull();
    }
  });
});
