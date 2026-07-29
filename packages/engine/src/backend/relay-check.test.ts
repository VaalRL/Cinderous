// 客戶端 relay 健檢的政策與分級（ADR-0275）。
//
// 主動探測本身是網路 I/O（core `relay-probe.ts`，CI 的 conformance 已在用真站驗證）；
// 這裡鎖的是**下放到客戶端後新增的決策**：何時該探測、快取語意、以及分級。
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadRelayCheck,
  RELAY_CHECK_TTL_MS,
  recordAuthObservation,
  relayGrade,
  saveRelayCheck,
  shouldProbe,
  type RelayCheck,
} from "./relay-check.js";

const ANCHORS = ["wss://anchor-a.example", "wss://anchor-b.example"];
const OTHER = "wss://relay.damus.io";
const NOW = 1_700_000_000_000;

const check = (over: Partial<RelayCheck> = {}): RelayCheck => ({
  at: NOW,
  live: true,
  ephemeral: true,
  rejectsExpired: true,
  ...over,
});

// node 測試環境無 localStorage：Map-backed shim（快取要真的讀寫得到）。
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

beforeEach(() => localStorage.clear());

describe("shouldProbe：何時該主動探測（ADR-0275）", () => {
  it("🔴 官方錨點**永不**客戶端探測——CI 每小時已在跑（ADR-0092），重複是浪費", () => {
    expect(shouldProbe(ANCHORS[0]!, ANCHORS, null, NOW)).toBe(false);
    // 即使快取很舊也不跑
    expect(shouldProbe(ANCHORS[0]!, ANCHORS, check({ at: 0 }), NOW)).toBe(false);
  });

  it("首次見到的 relay → 探測（正是使用者該知道風險的時刻）", () => {
    expect(shouldProbe(OTHER, ANCHORS, null, NOW)).toBe(true);
  });

  it("🔴 已檢查過就**不再每次連線都跑**（探測會寫入事件）", () => {
    expect(shouldProbe(OTHER, ANCHORS, check(), NOW)).toBe(false);
    // TTL 內都不跑
    expect(shouldProbe(OTHER, ANCHORS, check({ at: NOW - RELAY_CHECK_TTL_MS + 1000 }), NOW)).toBe(false);
  });

  it("超過 TTL（30 天）→ 重驗", () => {
    expect(shouldProbe(OTHER, ANCHORS, check({ at: NOW - RELAY_CHECK_TTL_MS - 1 }), NOW)).toBe(true);
  });
});

describe("快取讀寫", () => {
  it("round-trip；壞資料回 null（不讓毀損的快取影響通訊）", () => {
    saveRelayCheck(OTHER, check({ requiresAuth: true }));
    expect(loadRelayCheck(OTHER)).toEqual(check({ requiresAuth: true }));
    localStorage.setItem("nb.relayCheck." + OTHER, "{壞掉");
    expect(loadRelayCheck(OTHER)).toBeNull();
  });

  it("A 層觀察可獨立回填，且不覆寫既有探測結果", () => {
    saveRelayCheck(OTHER, check());
    recordAuthObservation(OTHER, false, NOW);
    const c = loadRelayCheck(OTHER)!;
    expect(c.requiresAuth).toBe(false);
    expect(c.ephemeral).toBe(true); // 探測結果保留
    expect(c.rejectsExpired).toBe(true);
  });

  it("尚無快取時，A 層觀察也能單獨建立紀錄", () => {
    recordAuthObservation(OTHER, true, NOW);
    expect(loadRelayCheck(OTHER)?.requiresAuth).toBe(true);
  });
});

describe("relayGrade：分級（只提示、不阻擋）", () => {
  it("未檢查＝unknown（如官方錨點）", () => {
    expect(relayGrade(null)).toBe("unknown");
  });
  it("連不上＝down", () => {
    expect(relayGrade(check({ live: false }))).toBe("down");
  });
  it("🔴 不要求 AUTH＝warn——收件匣公開可讀是最嚴重的風險", () => {
    expect(relayGrade(check({ requiresAuth: false }))).toBe("warn");
  });
  it("Ephemeral／過期語意不符＝warn（密文可能被無限期留存）", () => {
    expect(relayGrade(check({ ephemeral: false }))).toBe("warn");
    expect(relayGrade(check({ rejectsExpired: false }))).toBe("warn");
  });
  it("全過＝ok（含尚未觀察到 AUTH 的情況——不因未知就報警）", () => {
    expect(relayGrade(check())).toBe("ok");
    expect(relayGrade(check({ requiresAuth: true }))).toBe("ok");
  });
});
