import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSecretKey, getPublicKey } from "@cinderous/core";
import { WebRtcTransfer } from "./webrtc.js";
import type { OpenFileSink, ReceivedFile } from "@cinderous/core";

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

// ── ADR-0345：送檔管線——惰性分塊 ＋ 事件驅動背壓 ─────────────────────────
//
// 原本是「先把整份檔案的分塊框架都配置出來，再每 50ms 醒來看緩衝空了沒」。
// 兩個問題：一份多餘的整檔複製，以及一個永遠在轉的計時器。

/** 會記帳的資料通道樁：可控 `bufferedAmount`、支援 addEventListener。 */
class BufferedDc {
  readyState = "open";
  binaryType = "";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onmessage: ((e: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: (string | ArrayBuffer)[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();
  constructor() {
    lastDc = this as unknown as FakeDc;
  }
  send(m: string | ArrayBuffer): void {
    this.sent.push(m);
  }
  close(): void {}
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  /** 觸發排空事件（模擬網卡送完）。 */
  drain(): void {
    this.bufferedAmount = 0;
    for (const fn of [...(this.listeners.get("bufferedamountlow") ?? [])]) fn();
  }
  /** 目前掛著幾個排空監聽（用來驗證沒有洩漏）。 */
  get waiters(): number {
    return this.listeners.get("bufferedamountlow")?.size ?? 0;
  }
  /** 送出的二進位分塊數（不含 file-begin 字串）。 */
  get chunkCount(): number {
    return this.sent.filter((m) => typeof m !== "string").length;
  }
}

class BufferedPc extends FakePc {
  override createDataChannel(): FakeDc {
    return new BufferedDc() as unknown as FakeDc;
  }
}

/**
 * 沖刷微任務佇列。
 *
 * ADR-0346 之後分塊是**逐塊向來源要**的（`await src.slice(...)`），所以送出不再是同步完成
 * ——每一塊之間至少隔一個微任務。給足輪數讓小檔跑完。
 */
async function settle(rounds = 200): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe("WebRtcTransfer 送檔管線（ADR-0345／0346）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    vi.stubGlobal("RTCPeerConnection", BufferedPc);
    lastDc = undefined;
    const progress: Array<[string, number, number]> = [];
    const errors: string[] = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const t = new WebRtcTransfer(sk, {
      publishSignal: () => {},
      onOutgoingProgress: (_pk, id, sent, size) => progress.push([id, sent, size]),
      onIncoming: () => {},
      onError: (_pk, reason) => errors.push(reason),
    });
    t.connect(peer);
    const dc = lastDc as unknown as BufferedDc;
    dc.readyState = "open";
    lastDc!.onopen!();
    return { t, peer, dc, progress, errors };
  };

  const file = (n: number) => ({ name: "big.bin", mime: "x", bytes: new Uint8Array(n) });

  it("設定 bufferedAmountLowThreshold（沒設的話事件只在全空時才觸發）", () => {
    const { dc } = setup();
    expect(dc.bufferedAmountLowThreshold).toBe((1 << 20) / 2);
  });

  it("緩衝不滿時一路送完：file-begin ＋ 每塊各一則", async () => {
    const { t, peer, dc } = setup();
    t.sendFile(peer, file(16_384 * 3));
    await settle();
    expect(typeof dc.sent[0]).toBe("string"); // file-begin
    expect(dc.chunkCount).toBe(3);
    expect(dc.waiters).toBe(0); // 沒有卡住 ⇒ 不該留下監聽
  });

  it("進度逐塊回報，最後一筆等於檔案大小", async () => {
    const size = 16_384 * 3;
    const { t, peer, progress } = setup();
    t.sendFile(peer, file(size));
    await settle();
    expect(progress).toHaveLength(3);
    expect(progress.at(-1)).toEqual([progress[0]![0], size, size]);
  });

  it("不足一塊的尾段不會讓進度超過檔案大小", async () => {
    const size = 16_384 + 100;
    const { t, peer, progress } = setup();
    t.sendFile(peer, file(size));
    await settle();
    expect(progress.at(-1)![1]).toBe(size);
  });

  it("🔴 緩衝超過高水位即停手，並掛上排空監聽（不是每 50ms 輪詢）", async () => {
    const { t, peer, dc } = setup();
    dc.bufferedAmount = 2 << 20; // 高於高水位
    t.sendFile(peer, file(16_384 * 5));
    await settle();
    expect(dc.sent).toHaveLength(0); // 一則都沒送
    expect(dc.waiters).toBe(1);
  });

  it("🔴 排空事件一到就續傳，並解除監聽（不得累積）", async () => {
    const { t, peer, dc } = setup();
    dc.bufferedAmount = 2 << 20;
    t.sendFile(peer, file(16_384 * 4));
    await settle();
    expect(dc.waiters).toBe(1);
    dc.drain();
    await settle();
    expect(dc.chunkCount).toBe(4);
    expect(dc.waiters).toBe(0);
  });

  it("送到一半塞住 → 續傳接得回去，不重送也不漏塊", async () => {
    const { t, peer, dc } = setup();
    let count = 0;
    const realSend = dc.send.bind(dc);
    dc.send = (m: string | ArrayBuffer): void => {
      realSend(m);
      if (++count === 3) dc.bufferedAmount = 2 << 20; // 第三則之後塞住
    };
    t.sendFile(peer, file(16_384 * 5));
    await settle();
    expect(dc.chunkCount).toBe(2); // begin + 2 塊
    dc.drain();
    await settle();
    expect(dc.chunkCount).toBe(5);
  });

  it("🔴 保險計時器：排空事件沒來也不會永久卡住（卡住且不報錯是最糟的失敗）", async () => {
    vi.useFakeTimers();
    try {
      const { t, peer, dc } = setup();
      dc.bufferedAmount = 2 << 20;
      t.sendFile(peer, file(16_384 * 2));
      await vi.advanceTimersByTimeAsync(0);
      expect(dc.sent).toHaveLength(0);
      dc.bufferedAmount = 0; // 真的空了，但事件（模擬競態）從未觸發
      await vi.advanceTimersByTimeAsync(300);
      expect(dc.chunkCount).toBe(2);
      expect(dc.waiters).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("等待期間通道關閉 → 回報中斷而非靜默停住", async () => {
    const { t, peer, dc, errors } = setup();
    dc.bufferedAmount = 2 << 20;
    t.sendFile(peer, file(16_384 * 3));
    await settle();
    dc.readyState = "closed";
    dc.drain();
    await settle();
    expect(errors).toContain("傳輸中斷");
    expect(dc.waiters).toBe(0); // 收尾要清乾淨
  });

  it("佇列中的多個檔案依序送出", async () => {
    const { t, peer, dc } = setup();
    t.sendFile(peer, file(16_384));
    t.sendFile(peer, file(16_384 * 2));
    await settle();
    expect(dc.chunkCount).toBe(3);
    expect(dc.sent.filter((m) => typeof m === "string")).toHaveLength(2); // 兩個 file-begin
  });
});

describe("WebRtcTransfer 惰性來源送檔（ADR-0346）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    vi.stubGlobal("RTCPeerConnection", BufferedPc);
    lastDc = undefined;
    const progress: Array<[number, number]> = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const t = new WebRtcTransfer(sk, {
      publishSignal: () => {},
      onOutgoingProgress: (_pk, _id, sent, size) => progress.push([sent, size]),
      onIncoming: () => {},
      onError: () => {},
    });
    t.connect(peer);
    const dc = lastDc as unknown as BufferedDc;
    dc.readyState = "open";
    lastDc!.onopen!();
    return { t, peer, dc, progress };
  };

  /** 記帳型惰性來源：記下每次被讀的區段。 */
  const countingSource = (size: number) => {
    const reads: Array<[number, number]> = [];
    return {
      reads,
      src: {
        name: "huge.bin",
        mime: "application/octet-stream",
        size,
        slice: (offset: number, length: number): Promise<Uint8Array> => {
          reads.push([offset, length]);
          return Promise.resolve(new Uint8Array(length));
        },
      },
    };
  };

  it("🔴 整檔從未一次被讀出來——逐塊、每塊 CHUNK_SIZE", async () => {
    const { t, peer } = setup();
    const { reads, src } = countingSource(16_384 * 4);
    t.sendFile(peer, src);
    await settle();
    expect(reads).toEqual([
      [0, 16_384],
      [16_384, 16_384],
      [32_768, 16_384],
      [49_152, 16_384],
    ]);
    // 沒有任何一次讀取涵蓋整檔。
    expect(reads.every(([, len]) => len === 16_384)).toBe(true);
  });

  it("file-begin 的 size 來自來源，不是位元組長度", async () => {
    const { t, peer, dc } = setup();
    const { src } = countingSource(16_384 * 2);
    t.sendFile(peer, src);
    await settle();
    expect(JSON.parse(dc.sent[0] as string).size).toBe(16_384 * 2);
  });

  it("進度以來源宣告的大小為分母", async () => {
    const size = 16_384 * 3;
    const { t, peer, progress } = setup();
    t.sendFile(peer, countingSource(size).src);
    await settle();
    expect(progress.at(-1)).toEqual([size, size]);
  });

  it("🔴 背壓仍然有效——塞住時來源也跟著停讀（否則記憶體就從這裡漏回來）", async () => {
    const { t, peer, dc } = setup();
    const { reads, src } = countingSource(16_384 * 10);
    let count = 0;
    const realSend = dc.send.bind(dc);
    dc.send = (m: string | ArrayBuffer): void => {
      realSend(m);
      if (++count === 3) dc.bufferedAmount = 2 << 20;
    };
    t.sendFile(peer, src);
    await settle();
    expect(reads).toHaveLength(2); // 停手了就不再向來源要
    dc.drain();
    await settle();
    expect(reads).toHaveLength(10);
  });

  it("位元組檔與惰性來源走同一條管線（送出的框架一模一樣）", async () => {
    const payload = new Uint8Array(16_384 * 2 + 7).map((_, i) => i % 251);
    const a = setup();
    a.t.sendFile(a.peer, { name: "x.bin", mime: "application/octet-stream", bytes: payload });
    await settle();
    vi.unstubAllGlobals();
    const b = setup();
    b.t.sendFile(b.peer, {
      name: "x.bin",
      mime: "application/octet-stream",
      size: payload.length,
      slice: (offset: number, length: number) => Promise.resolve(payload.subarray(offset, offset + length)),
    });
    await settle();
    // file-begin 除了傳輸 id（時間戳）以外必須一模一樣。
    const withoutId = (m: string | ArrayBuffer): unknown => {
      const { id: _id, ...rest } = JSON.parse(m as string) as Record<string, unknown>;
      return rest;
    };
    expect(withoutId(b.dc.sent[0]!)).toEqual(withoutId(a.dc.sent[0]!));
    expect(b.dc.chunkCount).toBe(a.dc.chunkCount);
  });
});

describe("WebRtcTransfer 收檔串流落盤接線（ADR-0347）", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 把 A 送出的框架直接餵給 B 的資料通道（同一台機器上的兩端）。 */
  const wire = (openSink?: OpenFileSink) => {
    vi.stubGlobal("RTCPeerConnection", BufferedPc);
    lastDc = undefined;
    const received: ReceivedFile[] = [];
    const errors: string[] = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const rx = new WebRtcTransfer(
      sk,
      {
        publishSignal: () => {},
        onOutgoingProgress: () => {},
        onIncoming: (_pk, f) => received.push(f),
        onError: (_pk, r) => errors.push(r),
      },
      undefined,
      openSink,
    );
    rx.connect(peer);
    const dc = lastDc as unknown as BufferedDc;
    dc.readyState = "open";
    lastDc!.onopen!();
    // 送出即回灌給自己的收端（框架格式兩端相同）。
    dc.send = (m: string | ArrayBuffer): void => {
      lastDc!.onmessage!({ data: m });
    };
    return { rx, peer, received, errors };
  };

  /**
   * 9 MiB：**刻意超過 `sinkMinBytes` 的預設 8 MiB**（ADR-0347）。
   * 用真實門檻測，才會發現「門檻沒設對就悄悄退回記憶體」這種問題——小檔測不出來。
   */
  const payload = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251);

  /** 沖刷到收檔完成（576 塊，每塊至少一個微任務）。 */
  const settleUntil = async (done: () => boolean): Promise<void> => {
    for (let i = 0; i < 20_000 && !done(); i++) await Promise.resolve();
  };

  it("未提供 sink → 走記憶體，收到位元組（既有行為）", async () => {
    const { rx, peer, received } = wire();
    rx.sendFile(peer, { name: "a.bin", mime: "x", bytes: payload });
    await settleUntil(() => received.length > 0);
    expect(received).toHaveLength(1);
    expect(received[0]!.bytes).toBeDefined();
    expect(received[0]!.size).toBe(payload.length);
  });

  it("🔴 提供 sink → 大檔落盤，收到的是落腳處而非位元組", async () => {
    const writes: Array<[number, number]> = [];
    const { rx, peer, received } = wire(() => ({
      write: (offset, chunk) => void writes.push([offset, chunk.length]),
      close: () => ({ handle: "inbox.part" }),
      abort: () => {},
    }));
    rx.sendFile(peer, { name: "big.bin", mime: "x", bytes: payload });
    await settleUntil(() => received.length > 0);
    expect(received).toHaveLength(1);
    expect(received[0]!.bytes).toBeUndefined();
    expect(received[0]!.sink).toEqual({ handle: "inbox.part" });
    // 逐塊寫入，不是最後一次寫完。
    expect(writes.length).toBe(Math.ceil(payload.length / 16_384));
  });

  it("🔴 落盤內容與送出的位元組完全一致（端到端）", async () => {
    const assembled = new Uint8Array(payload.length);
    const { rx, peer, received } = wire(() => ({
      write: (offset, chunk) => void assembled.set(chunk, offset),
      close: () => ({ handle: "h" }),
      abort: () => {},
    }));
    rx.sendFile(peer, { name: "big.bin", mime: "x", bytes: payload });
    await settleUntil(() => received.length > 0);
    expect(received).toHaveLength(1);
    expect(Buffer.from(assembled).equals(Buffer.from(payload))).toBe(true);
  });

  it("惰性來源送出 ＋ 串流落盤：整條路徑兩端都不持有整檔（ADR-0346＋0347）", async () => {
    const assembled = new Uint8Array(payload.length);
    const reads: number[] = [];
    const { rx, peer, received } = wire(() => ({
      write: (offset, chunk) => void assembled.set(chunk, offset),
      close: () => ({ handle: "h" }),
      abort: () => {},
    }));
    rx.sendFile(peer, {
      name: "big.bin",
      mime: "x",
      size: payload.length,
      slice: (offset: number, length: number) => {
        reads.push(length);
        return Promise.resolve(payload.subarray(offset, offset + length));
      },
    });
    await settleUntil(() => received.length > 0);
    expect(received[0]!.bytes).toBeUndefined();
    expect(received[0]!.sink).toBeDefined();
    expect(reads.every((n) => n <= 16_384)).toBe(true); // 沒有任何一次讀整檔
    expect(Buffer.from(assembled).equals(Buffer.from(payload))).toBe(true);
  });
});
