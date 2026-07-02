import {
  createSignal,
  DataChannelReceiver,
  encodeFile,
  encodeNudge,
  generateSecretKey,
  getPublicKey,
  readSignal,
  SDP_SIGNAL_KIND,
  type NostrEvent,
  type PubkeyHex,
  type ReceivedFile,
  type RelayClient,
  type SecretKey,
  type Signal,
} from "@nostr-buddy/core";
import { createInMemoryRelayNetwork } from "@nostr-buddy/relay";

export interface WebRtcResult {
  connected: boolean;
  nudge: boolean;
  fileOk: boolean;
  fileName: string;
  log: string[];
}

const nowSec = () => Math.floor(Date.now() / 1000);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 在瀏覽器中以「真實」RTCPeerConnection 跑完整 P2P 流程：
 * SDP/ICE 經 core 的 signaling.ts（NIP-59 包封）走記憶體中的 RelayCore 交換，
 * 連線後以 datachannel.ts 傳 Nudge 與一個檔案並驗證重組。
 */
export async function runWebRtcScenario(): Promise<WebRtcResult> {
  const log: string[] = [];
  const say = (s: string) => {
    log.push(s);
  };

  const net = createInMemoryRelayNetwork({ now: nowSec });

  const aSk = generateSecretKey();
  const aPk = getPublicKey(aSk);
  const bSk = generateSecretKey();
  const bPk = getPublicKey(bSk);

  const pcA = new RTCPeerConnection();
  const pcB = new RTCPeerConnection();

  // 在 remoteDescription 設定前先緩衝 ICE candidate，避免 addIceCandidate 過早被拒。
  const hasRemote = new Set<RTCPeerConnection>();
  const pending = new Map<RTCPeerConnection, RTCIceCandidateInit[]>();
  async function addOrQueueCandidate(pc: RTCPeerConnection, init: RTCIceCandidateInit): Promise<void> {
    if (hasRemote.has(pc)) {
      await pc.addIceCandidate(init);
    } else {
      const q = pending.get(pc) ?? [];
      q.push(init);
      pending.set(pc, q);
    }
  }
  async function flushCandidates(pc: RTCPeerConnection): Promise<void> {
    hasRemote.add(pc);
    for (const init of pending.get(pc) ?? []) await pc.addIceCandidate(init);
    pending.delete(pc);
  }

  const candidateSignal = (c: RTCIceCandidate): Signal => ({
    type: "candidate",
    candidate: c.candidate,
    ...(c.sdpMid != null ? { sdpMid: c.sdpMid } : {}),
    ...(c.sdpMLineIndex != null ? { sdpMLineIndex: c.sdpMLineIndex } : {}),
  });

  function makeSignalingClient(
    id: string,
    ownSk: SecretKey,
    pc: RTCPeerConnection,
    peerPublish: () => RelayClient,
    peerPk: () => PubkeyHex,
  ): RelayClient {
    return net.connect(id, {
      onEvent: (_sub, event: NostrEvent) => {
        if (event.kind !== SDP_SIGNAL_KIND) return;
        const { signal } = readSignal(event, ownSk);
        void applySignal(pc, signal, ownSk, peerPublish(), peerPk());
      },
    });
  }

  async function applySignal(
    pc: RTCPeerConnection,
    signal: Signal,
    ownSk: SecretKey,
    client: RelayClient,
    peerPk: PubkeyHex,
  ): Promise<void> {
    if (signal.type === "candidate") {
      await addOrQueueCandidate(pc, {
        candidate: signal.candidate,
        sdpMid: signal.sdpMid ?? null,
        sdpMLineIndex: signal.sdpMLineIndex ?? null,
      });
    } else if (signal.type === "offer") {
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      await flushCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      client.publish(createSignal({ type: "answer", sdp: answer.sdp ?? "" }, ownSk, peerPk));
    } else {
      await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      await flushCandidates(pc);
    }
  }

  // 先建立雙方信令客戶端（互相引用）
  let aClient!: RelayClient;
  let bClient!: RelayClient;
  aClient = makeSignalingClient("A", aSk, pcA, () => aClient, () => bPk);
  bClient = makeSignalingClient("B", bSk, pcB, () => bClient, () => aPk);
  aClient.subscribe("sig", [{ kinds: [SDP_SIGNAL_KIND], "#p": [aPk] }]);
  bClient.subscribe("sig", [{ kinds: [SDP_SIGNAL_KIND], "#p": [bPk] }]);

  // ICE candidate 經信令交換
  pcA.onicecandidate = (ev) => {
    if (ev.candidate) aClient.publish(createSignal(candidateSignal(ev.candidate), aSk, bPk));
  };
  pcB.onicecandidate = (ev) => {
    if (ev.candidate) bClient.publish(createSignal(candidateSignal(ev.candidate), bSk, aPk));
  };

  const payload = new Uint8Array(40_000).map((_, i) => (i * 7) % 256);
  const fileName = "photo.bin";

  const done = new Promise<WebRtcResult>((resolve) => {
    let connected = false;
    let nudge = false;

    // B 收檔端
    pcB.ondatachannel = (ev) => {
      const ch = ev.channel;
      const rx = new DataChannelReceiver({
        onNudge: () => {
          nudge = true;
          say("B 收到 Nudge");
        },
        onFile: (file: ReceivedFile) => {
          const fileOk = file.name === fileName && bytesEqual(file.bytes, payload);
          say(`B 收到檔案 ${file.name}（${file.bytes.length} bytes），完整=${fileOk}`);
          resolve({ connected, nudge, fileOk, fileName: file.name, log });
        },
      });
      ch.binaryType = "arraybuffer";
      ch.onmessage = (m) => rx.receive(m.data as string | ArrayBuffer);
    };

    // A 發送端
    const dc = pcA.createDataChannel("buddy");
    dc.onopen = () => {
      connected = true;
      say("資料通道開啟（真實 WebRTC P2P）");
      dc.send(encodeNudge());
      for (const msg of encodeFile({ name: fileName, mime: "application/octet-stream", bytes: payload }, "f1", 8_192)) {
        if (typeof msg === "string") dc.send(msg);
        else dc.send(msg.buffer as ArrayBuffer);
      }
    };

    // A 發起 offer
    void (async () => {
      const offer = await pcA.createOffer();
      await pcA.setLocalDescription(offer);
      aClient.publish(createSignal({ type: "offer", sdp: offer.sdp ?? "" }, aSk, bPk));
      say("A 送出 offer");
    })();
  });

  return done;
}
