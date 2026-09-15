import { describe, expect, it, vi } from "vitest";
import { classifyIcePath, IcePathTracker, probeIcePath, type IcePath, type IceStatsEntry } from "./ice-path.js";

/** 組一張最小 stats 圖：一組 transport→candidate-pair→兩端候選。 */
function graph(localType: string, remoteType: string, extra: Partial<IceStatsEntry> = {}): IceStatsEntry[] {
  return [
    { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
    { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1", ...extra },
    { id: "L1", type: "local-candidate", candidateType: localType },
    { id: "R1", type: "remote-candidate", candidateType: remoteType },
  ];
}

describe("classifyIcePath — 選中配對的兩端候選型別決定路徑（ADR-0344）", () => {
  it("host ↔ host → direct（同網段直連）", () => {
    expect(classifyIcePath(graph("host", "host"))).toBe("direct");
  });

  it("srflx ↔ srflx → direct（STUN 打洞成功）", () => {
    expect(classifyIcePath(graph("srflx", "srflx"))).toBe("direct");
  });

  it("本端 relay → relay（位元組經我方 TURN 轉送）", () => {
    expect(classifyIcePath(graph("relay", "srflx"))).toBe("relay");
  });

  it("對端 relay → relay（TURN 只要有一端在用，位元組就必經那台）", () => {
    expect(classifyIcePath(graph("srflx", "relay"))).toBe("relay");
  });

  it("兩端皆 relay → relay", () => {
    expect(classifyIcePath(graph("relay", "relay"))).toBe("relay");
  });

  it("prflx ↔ host → direct（peer-reflexive 仍是直連）", () => {
    expect(classifyIcePath(graph("prflx", "host"))).toBe("direct");
  });
});

describe("classifyIcePath — 選出「哪一組才是在用的配對」", () => {
  it("忽略未被選中的配對：選中的是直連，圖裡另有一組 relay 也不受影響", () => {
    const reports: IceStatsEntry[] = [
      ...graph("host", "host"),
      { id: "P2", type: "candidate-pair", state: "succeeded", localCandidateId: "L2", remoteCandidateId: "R2" },
      { id: "L2", type: "local-candidate", candidateType: "relay" },
      { id: "R2", type: "remote-candidate", candidateType: "relay" },
    ];
    expect(classifyIcePath(reports)).toBe("direct");
  });

  it("無 transport 時採信 Firefox 的 pair.selected", () => {
    const reports: IceStatsEntry[] = [
      { id: "P1", type: "candidate-pair", selected: true, state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "P2", type: "candidate-pair", state: "failed", localCandidateId: "L2", remoteCandidateId: "R2" },
      { id: "L1", type: "local-candidate", candidateType: "relay" },
      { id: "R1", type: "remote-candidate", candidateType: "host" },
      { id: "L2", type: "local-candidate", candidateType: "host" },
      { id: "R2", type: "remote-candidate", candidateType: "host" },
    ];
    expect(classifyIcePath(reports)).toBe("relay");
  });

  it("無 transport／selected 時採信唯一一組 nominated+succeeded", () => {
    const reports: IceStatsEntry[] = [
      { id: "P1", type: "candidate-pair", nominated: true, state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "P2", type: "candidate-pair", nominated: false, state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "L1", type: "local-candidate", candidateType: "srflx" },
      { id: "R1", type: "remote-candidate", candidateType: "srflx" },
    ];
    expect(classifyIcePath(reports)).toBe("direct");
  });

  it("最後退路：整張圖只有一組 succeeded 配對就採信它", () => {
    const reports: IceStatsEntry[] = [
      { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "P2", type: "candidate-pair", state: "in-progress", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "L1", type: "local-candidate", candidateType: "relay" },
      { id: "R1", type: "remote-candidate", candidateType: "host" },
    ];
    expect(classifyIcePath(reports)).toBe("relay");
  });

  it("多組 succeeded 且都判不出誰在用 → unknown（不猜）", () => {
    const reports: IceStatsEntry[] = [
      { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "P2", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "L1", type: "local-candidate", candidateType: "host" },
      { id: "R1", type: "remote-candidate", candidateType: "host" },
    ];
    expect(classifyIcePath(reports)).toBe("unknown");
  });
});

describe("classifyIcePath — 畸形輸入一律 unknown，不丟例外", () => {
  it("null / undefined / 空陣列", () => {
    expect(classifyIcePath(null)).toBe("unknown");
    expect(classifyIcePath(undefined)).toBe("unknown");
    expect(classifyIcePath([])).toBe("unknown");
  });

  it("選中的配對指向不存在的候選 id", () => {
    const reports: IceStatsEntry[] = [
      { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
      { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "MISSING", remoteCandidateId: "GONE" },
    ];
    expect(classifyIcePath(reports)).toBe("unknown");
  });

  it("只解得出一端 → unknown（資訊不足時不敢說直連）", () => {
    const reports: IceStatsEntry[] = [
      { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
      { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "MISSING" },
      { id: "L1", type: "local-candidate", candidateType: "host" },
    ];
    expect(classifyIcePath(reports)).toBe("unknown");
  });

  it("id 撞名到非候選報告時不誤讀", () => {
    const reports: IceStatsEntry[] = [
      { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
      { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "L1", type: "inbound-rtp", candidateType: "relay" },
      { id: "R1", type: "remote-candidate", candidateType: "host" },
    ];
    expect(classifyIcePath(reports)).toBe("unknown");
  });

  it("欄位型別錯亂（數字 id、缺 type）不當機", () => {
    const reports = [{ id: 42, type: null }, null, "nonsense", { type: "candidate-pair" }] as unknown as IceStatsEntry[];
    expect(classifyIcePath(reports)).toBe("unknown");
  });

  it("selectedCandidatePairId 指到的不是 candidate-pair → 退回其他判法", () => {
    const reports: IceStatsEntry[] = [
      { id: "T1", type: "transport", selectedCandidatePairId: "L1" },
      { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      { id: "L1", type: "local-candidate", candidateType: "relay" },
      { id: "R1", type: "remote-candidate", candidateType: "host" },
    ];
    expect(classifyIcePath(reports)).toBe("relay");
  });
});

describe("probeIcePath — 從 RTCPeerConnection 取 stats", () => {
  it("maplike 的 RTCStatsReport 走 values()（直接迭代拿到的是 [id, report] 配對）", async () => {
    const report = new Map(graph("relay", "host").map((r) => [String(r["id"]), r]));
    expect(await probeIcePath({ getStats: () => Promise.resolve(report) })).toBe("relay");
  });

  it("陣列替身同樣可用", async () => {
    expect(await probeIcePath({ getStats: () => Promise.resolve(graph("host", "host")) })).toBe("direct");
  });

  it("同步回傳（非 Promise）也接受", async () => {
    expect(await probeIcePath({ getStats: () => graph("srflx", "relay") })).toBe("relay");
  });

  it("只有 forEach 的舊式報告", async () => {
    const entries = graph("host", "host");
    const legacy = { forEach: (cb: (v: unknown) => void) => entries.forEach((e) => cb(e)) };
    expect(await probeIcePath({ getStats: () => legacy })).toBe("direct");
  });

  it("沒有 getStats（舊 webview／測試替身）→ unknown，不丟例外", async () => {
    expect(await probeIcePath({})).toBe("unknown");
    expect(await probeIcePath(null)).toBe("unknown");
  });

  it("getStats 拋例外 → unknown（旁路資訊絕不拖垮連線）", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    expect(await probeIcePath({ getStats: boom })).toBe("unknown");
  });

  it("getStats 回傳 rejected promise → unknown", async () => {
    expect(await probeIcePath({ getStats: () => Promise.reject(new Error("nope")) })).toBe("unknown");
  });
});

describe("IcePathTracker — 何時探測、何時作廢、變了才通知", () => {
  const source = (stats: IceStatsEntry[]) => ({ getStats: () => Promise.resolve(stats) });
  const DIRECT = graph("host", "host");
  const RELAY = graph("relay", "host");

  it("初始為 unknown", () => {
    expect(new IcePathTracker(() => {}).path).toBe("unknown");
  });

  it("refresh 測出結果並通知一次", async () => {
    const seen: IcePath[] = [];
    const tracker = new IcePathTracker((p) => seen.push(p));
    expect(await tracker.refresh(source(RELAY))).toBe("relay");
    expect(tracker.path).toBe("relay");
    expect(seen).toEqual(["relay"]);
  });

  it("同值不重複通知", async () => {
    const seen: IcePath[] = [];
    const tracker = new IcePathTracker((p) => seen.push(p));
    await tracker.refresh(source(RELAY));
    await tracker.refresh(source(RELAY));
    await tracker.refresh(source(RELAY));
    expect(seen).toEqual(["relay"]);
  });

  it("判定改變才再通知（relay → 升級為直連）", async () => {
    const seen: IcePath[] = [];
    const tracker = new IcePathTracker((p) => seen.push(p));
    await tracker.refresh(source(RELAY));
    await tracker.refresh(source(DIRECT));
    expect(seen).toEqual(["relay", "direct"]);
  });

  it("start 排定有界探測，時間到自動測出", async () => {
    vi.useFakeTimers();
    try {
      const seen: IcePath[] = [];
      const tracker = new IcePathTracker((p) => seen.push(p));
      tracker.start(source(RELAY));
      await vi.advanceTimersByTimeAsync(50);
      expect(seen).toEqual(["relay"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("start 之後路徑變了，後續排程會補抓到（不會永久標成經中繼）", async () => {
    vi.useFakeTimers();
    try {
      const seen: IcePath[] = [];
      const tracker = new IcePathTracker((p) => seen.push(p));
      let stats = RELAY;
      tracker.start({ getStats: () => Promise.resolve(stats) });
      await vi.advanceTimersByTimeAsync(50);
      stats = DIRECT; // ICE 換到更好的配對
      await vi.advanceTimersByTimeAsync(20_000);
      expect(seen).toEqual(["relay", "direct"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset 之後排程中的探測不再回報，路徑歸零", async () => {
    vi.useFakeTimers();
    try {
      const seen: IcePath[] = [];
      const tracker = new IcePathTracker((p) => seen.push(p));
      tracker.start(source(RELAY));
      tracker.reset();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(seen).toEqual([]);
      expect(tracker.path).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("在途探測遇上 reset 會自我作廢（上一條連線的判定不得蓋到下一條）", async () => {
    const seen: IcePath[] = [];
    const tracker = new IcePathTracker((p) => seen.push(p));
    let release: (v: IceStatsEntry[]) => void = () => {};
    const pending = new Promise<IceStatsEntry[]>((r) => (release = r));
    const inflight = tracker.refresh({ getStats: () => pending });
    tracker.reset(); // 通話掛斷／通道關閉
    release(RELAY); // 探測這才回來
    await inflight;
    expect(seen).toEqual([]);
    expect(tracker.path).toBe("unknown");
  });

  it("重複 start 會先作廢前一輪（不累積計時器、不重複回報）", async () => {
    vi.useFakeTimers();
    try {
      const seen: IcePath[] = [];
      const tracker = new IcePathTracker((p) => seen.push(p));
      tracker.start(source(RELAY));
      tracker.start(source(RELAY));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(seen).toEqual(["relay"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
