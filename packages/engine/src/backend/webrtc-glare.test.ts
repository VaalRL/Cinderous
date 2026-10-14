// 直連協商的碰撞與卡住（ADR-0384）。
//
// 兩人同時打開對話 → 兩顆 offer 在中繼上交錯；或一顆 answer 掉了、一方卡在「等 answer」。
// 修正前：瀏覽器丟 InvalidStateError／「Failed to set SSL role for the transport」，對話裡多一行
// 「⚠️ 信令處理失敗」，直連也沒建立。
import type { NostrEvent } from "@cinderous/core";
import { generateSecretKey, getPublicKey } from "@cinderous/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebRtcTransfer } from "./webrtc.js";

type Desc = { type: string; sdp?: string };

class FakeDc {
  readyState = "connecting";
  binaryType = "";
  bufferedAmountLowThreshold = 0;
  onmessage: ((e: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

/**
 * 照瀏覽器的規則檢查狀態轉換，不合法就丟錯（沒有隱式 rollback——舊版 WebView 也是這樣）。
 * 也模擬 DTLS 角色：連線第一次談成後角色就定了（rollback 不會清掉），之後的 answer 要和它相容。
 */
class StrictPc {
  signalingState = "stable";
  remoteDescription: Desc | null = null;
  /** DTLS 角色：answer 方＝client（setup:active）、offer 方＝server */
  role: "client" | "server" | undefined;
  connectionState = "new";
  closed = false;
  onicecandidate: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: FakeDc }) => void) | null = null;
  createDataChannel(): FakeDc {
    return new FakeDc();
  }
  async createOffer(): Promise<Desc> {
    return { type: "offer", sdp: "a=setup:actpass" };
  }
  async createAnswer(): Promise<Desc> {
    if (this.signalingState !== "have-remote-offer") throw new Error("InvalidStateError: createAnswer");
    return { type: "answer", sdp: `a=setup:${this.role === "server" ? "passive" : "active"}` };
  }
  async setLocalDescription(d: Desc): Promise<void> {
    const s = this.signalingState;
    if (d.type === "offer" && s === "stable") this.signalingState = "have-local-offer";
    else if (d.type === "answer" && s === "have-remote-offer") {
      this.signalingState = "stable";
      this.role ??= "client";
    } else if (d.type === "rollback" && s === "have-local-offer") this.signalingState = "stable";
    else throw new Error(`InvalidStateError: setLocalDescription(${d.type}) in ${s}`);
  }
  async setRemoteDescription(d: Desc): Promise<void> {
    const s = this.signalingState;
    if (d.type === "offer" && s === "stable") this.signalingState = "have-remote-offer";
    else if (d.type === "answer" && s === "have-local-offer") {
      const want = d.sdp?.includes("active") ? "server" : "client";
      if (this.role !== undefined && this.role !== want) {
        throw new Error("InvalidAccessError: Failed to set remote answer sdp: Failed to set SSL role for the transport.");
      }
      this.role = want;
      this.signalingState = "stable";
    } else throw new Error(`InvalidAccessError: Failed to set SSL role for the transport (${d.type} in ${s})`);
    this.remoteDescription = d;
  }
  async addIceCandidate(): Promise<void> {
    if (!this.remoteDescription) throw new Error("InvalidStateError: no remote description");
  }
  close(): void {
    this.closed = true;
  }
}

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** 兩端；`polite` 指定哪一端讓步（公鑰較大者） */
function pair(politeSide: "a" | "b") {
  let skA = generateSecretKey();
  let skB = generateSecretKey();
  const big = getPublicKey(skA) > getPublicKey(skB);
  if ((politeSide === "a") !== big) [skA, skB] = [skB, skA];
  const pkA = getPublicKey(skA);
  const pkB = getPublicKey(skB);
  const errors: string[] = [];
  const toA: NostrEvent[] = [];
  const toB: NostrEvent[] = [];
  const handlers = (outbox: NostrEvent[]) => ({
    publishSignal: (e: NostrEvent) => outbox.push(e),
    onOutgoingProgress: () => {},
    onIncoming: () => {},
    onError: (_pk: string, reason: string) => errors.push(reason),
  });
  const a = new WebRtcTransfer(skA, handlers(toB));
  const b = new WebRtcTransfer(skB, handlers(toA));
  /** 對方那條連線目前的 RTCPeerConnection（測試用：看談成了沒） */
  const pcOf = (t: WebRtcTransfer, pk: string) =>
    (t as unknown as { peers: Map<string, { pc: StrictPc }> }).peers.get(pk)?.pc;
  /** 信令來回送到沒有新信令為止（每輪把雙方佇列一起送出＝交錯） */
  const pump = async () => {
    for (let round = 0; round < 10 && (toA.length > 0 || toB.length > 0); round++) {
      const forA = toA.splice(0);
      const forB = toB.splice(0);
      for (const e of forA) a.onSignalEvent(e);
      for (const e of forB) b.onSignalEvent(e);
      await settle();
    }
  };
  /** 雙方目前的連線都已談成（stable、有對方的描述） */
  const negotiated = () => {
    const pa = pcOf(a, pkB);
    const pb = pcOf(b, pkA);
    return (
      pa?.signalingState === "stable" && pb?.signalingState === "stable" && pa.remoteDescription !== null && pb.remoteDescription !== null
    );
  };
  return { a, b, pkA, pkB, errors, toA, toB, pump, pcOf, negotiated };
}

describe("直連協商的碰撞與卡住（ADR-0384）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  for (const polite of ["a", "b"] as const) {
    it(`兩顆 offer 交錯（讓步的是 ${polite}）：不報錯、談成一條連線，只採用其中一顆 offer`, async () => {
      vi.stubGlobal("RTCPeerConnection", StrictPc);
      const p = pair(polite);
      p.a.connect(p.pkB);
      p.b.connect(p.pkA);
      await settle(); // 兩邊的 offer 都已送出、還沒收到對方的
      await p.pump();
      expect(p.errors).toEqual([]);
      expect(p.negotiated()).toBe(true);
      const types = new Set([p.pcOf(p.a, p.pkB)!.remoteDescription!.type, p.pcOf(p.b, p.pkA)!.remoteDescription!.type]);
      expect(types).toEqual(new Set(["offer", "answer"]));
    });
  }

  it("過期的 answer（已經不在等 answer）→ 安靜略過，不在對話裡報錯", async () => {
    vi.stubGlobal("RTCPeerConnection", StrictPc);
    const p = pair("a");
    p.b.connect(p.pkA);
    await settle();
    await p.pump(); // 談成
    const stale = p.toA.splice(0);
    // 再送一次同一顆 answer：A 已經 stable
    p.b.connect(p.pkA); // 通道仍在連線中、還沒過期 → 不重來
    await settle();
    for (const e of stale) p.a.onSignalEvent(e);
    await settle();
    expect(p.errors).toEqual([]);
  });

  it("answer 掉了、讓步的一方卡在等 answer；對方之後打開對話 → 換新連線重談，不撞 DTLS 角色（實測的錯誤）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("RTCPeerConnection", StrictPc);
    const p = pair("a"); // A 讓步
    p.a.connect(p.pkB);
    await settle();
    await p.pump();
    expect(p.negotiated()).toBe(true);
    // 重來一次，這回 B 的 answer 掉了：A 卡在 have-local-offer，B 的連線角色已定（client）
    p.a.connect(p.pkB); // 通道沒開（假通道永遠在連線中）、但還沒過期 → 不動
    vi.setSystemTime(Date.now() + 11_000);
    p.a.connect(p.pkB); // 過期 → 換新連線重送 offer
    await settle();
    p.b.onSignalEvent(p.toB.shift()!);
    await settle();
    p.toA.length = 0; // B 的 answer 掉了
    expect(p.pcOf(p.a, p.pkB)!.signalingState).toBe("have-local-offer");
    // B 打開對話
    vi.setSystemTime(Date.now() + 11_000);
    p.b.connect(p.pkA);
    await settle();
    await p.pump();
    expect(p.errors).toEqual([]);
    expect(p.negotiated()).toBe(true);
  });

  it("offer 掉了、不讓步的一方卡在等 answer → 過了 10 秒，對方的 offer 照收（不再永遠略過）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("RTCPeerConnection", StrictPc);
    const p = pair("b"); // A 不讓步
    p.a.connect(p.pkB);
    await settle();
    p.toB.length = 0; // A 的 offer 掉了（B 當時不在線）
    vi.setSystemTime(Date.now() + 11_000);
    p.b.connect(p.pkA);
    await settle();
    await p.pump();
    expect(p.errors).toEqual([]);
    expect(p.negotiated()).toBe(true);
  });

  it("信令套用失敗不在對話裡報錯（直連是盡力而為，ADR-0210）；連線重置，下次打開對話重談", async () => {
    vi.stubGlobal("RTCPeerConnection", StrictPc);
    const p = pair("a");
    p.b.connect(p.pkA);
    await settle();
    const offer = p.toA.shift()!;
    p.a.onSignalEvent(offer);
    await settle();
    const answer = p.toB.shift()!;
    p.b.onSignalEvent(answer);
    await settle();
    // 同一顆 offer 又送到 A 一次（例如中繼重播）：A 換新連線重談，不報錯
    p.a.onSignalEvent(offer);
    await settle();
    expect(p.errors).toEqual([]);
  });
});
