import { TIMESTAMP_JITTER_SECONDS } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import {
  ABUSE_GUARD,
  acceptFileEvents,
  eventsPerMinuteFrom,
  firstHost,
  MAX_EVENTS_PER_MINUTE,
  MAX_PAST_SKEW_SEC,
  storeOptions,
  ttlSecondsFromDays,
  TTL_CAP_DAYS,
} from "./host-config.js";

// 宿主組裝設定（ADR-0235 H1）。H1 的教訓是「組裝層沒人測」——防護在 core 裡寫對了也測了，
// 但 worker 從未把參數傳進去。這裡把常數與衍生邏輯的**不變量**釘死，兩座宿主不可能各走各的。
describe("host-config：濫用防護不變量（ADR-0235 H1）", () => {
  it("🔴 過去時鐘窗必須大於 NIP-59 抖動窗——否則會擋掉幾乎每一則 Gift Wrap", () => {
    // 這是整組設定裡最容易踩、後果最嚴重的一條：對稱或過小的過去窗會讓外層時戳被往前推
    // 將近兩天的正常 Gift Wrap 全部被拒。留白一小時給實際時鐘誤差。
    expect(MAX_PAST_SKEW_SEC).toBeGreaterThan(TIMESTAMP_JITTER_SECONDS);
    expect(MAX_PAST_SKEW_SEC).toBe(TIMESTAMP_JITTER_SECONDS + 3600);
  });

  it("ABUSE_GUARD 帶齊四道防線（速率／訂閱數／時鐘窗／重放）", () => {
    expect(ABUSE_GUARD.maxEventsPerMinute).toBe(MAX_EVENTS_PER_MINUTE);
    expect(ABUSE_GUARD.maxSubscriptions).toBeGreaterThan(0);
    expect(ABUSE_GUARD.maxFutureSkewSec).toBeGreaterThan(0);
    expect(ABUSE_GUARD.maxPastSkewSec).toBe(MAX_PAST_SKEW_SEC);
    expect(ABUSE_GUARD.replayWindowSec).toBeGreaterThan(0);
    expect(ABUSE_GUARD.authMaxAgeSec).toBe(600);
  });
});

describe("host-config：TTL 天數 → 秒（ADR-0160）", () => {
  it("未設／壞值／<1 → undefined（store 用預設 7 天）", () => {
    expect(ttlSecondsFromDays(undefined)).toBeUndefined();
    expect(ttlSecondsFromDays("0")).toBeUndefined();
    expect(ttlSecondsFromDays("abc")).toBeUndefined();
    expect(ttlSecondsFromDays("-5")).toBeUndefined();
  });

  it("正常值換算成秒", () => {
    expect(ttlSecondsFromDays("90")).toBe(90 * 86_400);
    expect(ttlSecondsFromDays("1")).toBe(86_400);
  });

  it("🔴 超大值被 clamp（防 MAX_TTL_DAYS=99999 這類手誤產生實質無界保留）", () => {
    expect(ttlSecondsFromDays("99999")).toBe(TTL_CAP_DAYS * 86_400);
  });

  it("storeOptions 一律帶每收件人上限；TTL 依 env", () => {
    expect(storeOptions(undefined)).toEqual({ maxPerRecipient: 500 });
    expect(storeOptions("90")).toEqual({ maxPerRecipient: 500, maxTtlSeconds: 90 * 86_400 });
  });
});

describe("host-config：檔案塊開關（ADR-0162）", () => {
  it("未設／<1／壞值 → false（公共站零儲存風險）", () => {
    expect(acceptFileEvents(undefined)).toBe(false);
    expect(acceptFileEvents("0")).toBe(false);
    expect(acceptFileEvents("abc")).toBe(false);
  });
  it("≥1 → true", () => {
    expect(acceptFileEvents("1")).toBe(true);
    expect(acceptFileEvents("16")).toBe(true);
  });
});

describe("host-config：速率覆寫（node 自架）", () => {
  it("未設 → 預設 120", () => {
    expect(eventsPerMinuteFrom(undefined)).toBe(MAX_EVENTS_PER_MINUTE);
  });
  it("壞值 → 預設 120（不因手誤把限制關掉）", () => {
    expect(eventsPerMinuteFrom("abc")).toBe(MAX_EVENTS_PER_MINUTE);
  });
  it("正整數 → 採用；0／負 → 明確關閉（undefined）", () => {
    expect(eventsPerMinuteFrom("300")).toBe(300);
    expect(eventsPerMinuteFrom("0")).toBeUndefined();
  });
});

describe("host-config：主機正規化（ADR-0235 H2）", () => {
  it("小寫、去空白", () => {
    expect(firstHost("Relay.Example.com")).toBe("relay.example.com");
    expect(firstHost("  relay.example.com  ")).toBe("relay.example.com");
  });
  it("X-Forwarded-Host 逗號串取第一個（反向代理疊加）", () => {
    expect(firstHost("relay.example.com, internal:8787")).toBe("relay.example.com");
  });
  it("空／undefined → undefined（不強制 relay tag 檢查）", () => {
    expect(firstHost(undefined)).toBeUndefined();
    expect(firstHost("")).toBeUndefined();
    expect(firstHost("   ")).toBeUndefined();
  });
});
