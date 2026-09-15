import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSecretKey, getPublicKey } from "@cinderous/core";
import { WebRtcTransfer } from "./webrtc.js";

// 最小 RTCPeerConnection 樁：捕捉最後建立的 pc/dc，供測試手動觸發開/關/失敗（node 無真實 WebRTC）。
let lastDc: FakeDc | undefined;
let lastPc: FakePc | undefined;
class FakeDc {
  readyState = "connecting";
  binaryType = "";
  onmessage: ((e: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    lastDc = this;
  }
  send(): void {}
  close(): void {}
}
class FakePc {
  onicecandidate: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: unknown = null;
  connectionState = "new";
  constructor() {
    lastPc = this;
  }
  createDataChannel(): FakeDc {
    return new FakeDc();
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "" };
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "" };
  }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}

describe("WebRtcTransfer 直連狀態回報（ADR-0213）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mk = () => {
    vi.stubGlobal("RTCPeerConnection", FakePc);
    lastDc = undefined;
    lastPc = undefined;
    const events: Array<[string, boolean]> = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const t = new WebRtcTransfer(sk, {
      publishSignal: () => {},
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: () => {},
      onConnectionState: (pk, c) => events.push([pk, c]),
    });
    // connect() → startOffer 同步建立資料通道並掛好 onopen/onclose 與 pc.onconnectionstatechange。
    t.connect(peer);
    return { peer, events };
  };

  it("資料通道開啟 → onConnectionState(peer, true)（直連可用）", () => {
    const { peer, events } = mk();
    lastDc!.readyState = "open";
    lastDc!.onopen!();
    expect(events).toContainEqual([peer, true]);
  });

  it("資料通道關閉 → onConnectionState(peer, false)（直連中斷）", () => {
    const { peer, events } = mk();
    lastDc!.onclose!();
    expect(events).toContainEqual([peer, false]);
  });

  it("連線失敗（pc connectionState=failed）→ onConnectionState(peer, false)（降級走 relay）", () => {
    const { peer, events } = mk();
    lastPc!.connectionState = "failed";
    lastPc!.onconnectionstatechange!();
    expect(events).toContainEqual([peer, false]);
  });
});

// ── ADR-0344：ICE 路徑判定（直連 vs 經 TURN 中繼）──
//
// 為什麼要測到這一層：位元組走 TURN 是**按流量計費**的，而 ADR-0243 核可公共 TURN 的成本
// 論證是以通話為基礎。要替大檔把關，前提是程式分辨得出自己在哪條路上。

/** 一張會判成「經中繼」的 stats 圖。 */
const RELAY_STATS = [
  { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
  { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
  { id: "L1", type: "local-candidate", candidateType: "relay" },
  { id: "R1", type: "remote-candidate", candidateType: "srflx" },
];

/** 一張會判成「直連」的 stats 圖。 */
const DIRECT_STATS = [
  { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
  { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
  { id: "L1", type: "local-candidate", candidateType: "srflx" },
  { id: "R1", type: "remote-candidate", candidateType: "srflx" },
];

class StatsPc extends FakePc {
  static stats: unknown[] = DIRECT_STATS;
  getStats(): Promise<unknown[]> {
    return Promise.resolve(StatsPc.stats);
  }
}

describe("WebRtcTransfer ICE 路徑判定（ADR-0344）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mkStats = () => {
    vi.stubGlobal("RTCPeerConnection", StatsPc);
    lastDc = undefined;
    lastPc = undefined;
    const events: Array<[string, boolean, string | undefined]> = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const t = new WebRtcTransfer(sk, {
      publishSignal: () => {},
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: () => {},
      onConnectionState: (pk, c, path) => events.push([pk, c, path]),
    });
    t.connect(peer);
    return { t, peer, events };
  };

  /** 讓通道進入 open 狀態（同 ADR-0213 既有測試的手法）。 */
  const open = () => {
    lastDc!.readyState = "open";
    lastDc!.onopen!();
  };

  it("通道剛開時先誠實回報 unknown（還沒測，不能假裝是直連）", () => {
    StatsPc.stats = DIRECT_STATS;
    const { peer, events } = mkStats();
    open();
    expect(events).toContainEqual([peer, true, "unknown"]);
  });

  it("探測後判為經中繼 → 回報 relay，且 icePath() 查得到", async () => {
    StatsPc.stats = RELAY_STATS;
    const { t, peer, events } = mkStats();
    open();
    expect(await t.refreshIcePath(peer)).toBe("relay");
    expect(t.icePath(peer)).toBe("relay");
    expect(events).toContainEqual([peer, true, "relay"]);
  });

  it("探測後判為直連 → 回報 direct", async () => {
    StatsPc.stats = DIRECT_STATS;
    const { t, peer, events } = mkStats();
    open();
    expect(await t.refreshIcePath(peer)).toBe("direct");
    expect(events).toContainEqual([peer, true, "direct"]);
  });

  it("結果沒變就不重複回報（避免 UI 被同值訊息洗版）", async () => {
    StatsPc.stats = RELAY_STATS;
    const { t, peer, events } = mkStats();
    open();
    await t.refreshIcePath(peer);
    await t.refreshIcePath(peer);
    await t.refreshIcePath(peer);
    expect(events.filter(([, , path]) => path === "relay")).toHaveLength(1);
  });

  it("路徑改變（relay → 打洞成功升級為直連）會再回報一次", async () => {
    StatsPc.stats = RELAY_STATS;
    const { t, peer, events } = mkStats();
    open();
    await t.refreshIcePath(peer);
    StatsPc.stats = DIRECT_STATS;
    expect(await t.refreshIcePath(peer)).toBe("direct");
    expect(events.map(([, , path]) => path)).toEqual(["unknown", "relay", "direct"]);
  });

  it("通道未開 → icePath 為 unknown（沒連上就沒有「路徑」可言）", async () => {
    StatsPc.stats = RELAY_STATS;
    const { t, peer } = mkStats();
    expect(t.icePath(peer)).toBe("unknown");
    expect(await t.refreshIcePath(peer)).toBe("unknown");
  });

  it("通道關閉後路徑歸零，不留下過期的 relay 判定", async () => {
    StatsPc.stats = RELAY_STATS;
    const { t, peer } = mkStats();
    open();
    await t.refreshIcePath(peer);
    expect(t.icePath(peer)).toBe("relay");
    lastDc!.readyState = "closed";
    lastDc!.onclose!();
    expect(t.icePath(peer)).toBe("unknown");
  });

  it("連線失敗後路徑同樣歸零", async () => {
    StatsPc.stats = RELAY_STATS;
    const { t, peer } = mkStats();
    open();
    await t.refreshIcePath(peer);
    lastPc!.connectionState = "failed";
    lastPc!.onconnectionstatechange!();
    lastDc!.readyState = "closed";
    expect(t.icePath(peer)).toBe("unknown");
  });

  it("未知的聯絡人 → unknown，不丟例外", async () => {
    const { t } = mkStats();
    expect(t.icePath("deadbeef")).toBe("unknown");
    expect(await t.refreshIcePath("deadbeef")).toBe("unknown");
  });

  it("排程探測會自動跑（不必手動 refresh）", async () => {
    vi.useFakeTimers();
    try {
      StatsPc.stats = RELAY_STATS;
      const { peer, events } = mkStats();
      open();
      await vi.advanceTimersByTimeAsync(50);
      expect(events).toContainEqual([peer, true, "relay"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close() 之後排程中的探測不再回報（peer 已丟棄）", async () => {
    vi.useFakeTimers();
    try {
      StatsPc.stats = RELAY_STATS;
      const { t, peer, events } = mkStats();
      open();
      t.close();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(events.some(([, , path]) => path === "relay")).toBe(false);
      expect(t.icePath(peer)).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("沒有 getStats 的 webview（既有 FakePc）→ 維持 unknown，不當機", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePc);
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const t = new WebRtcTransfer(sk, {
      publishSignal: () => {},
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: () => {},
    });
    t.connect(peer);
    lastDc!.readyState = "open";
    lastDc!.onopen!();
    expect(await t.refreshIcePath(peer)).toBe("unknown");
  });
});
