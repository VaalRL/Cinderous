import { describe, expect, it } from "vitest";
import {
  createPairing,
  decryptBundle,
  deriveSas,
  encodePairing,
  encryptBundle,
  type PairTransport,
  parsePairing,
  roomKeyFrom,
  sealSignal,
  openSignal,
  runPairingSource,
  runPairingTarget,
} from "./pairing.js";

describe("QR 配對載荷", () => {
  it("createPairing 產生 32-byte 一次性金鑰與含 lan/room 的載荷", () => {
    const { payload, key } = createPairing("192.168.1.5", "room-abc");
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
    expect(payload.lan).toBe("192.168.1.5");
    expect(payload.room).toBe("room-abc");
    expect(payload.v).toBe(1);
  });

  it("編碼後可解析回相同金鑰與欄位", () => {
    const { payload, key } = createPairing("10.0.0.2", "r1");
    const parsed = parsePairing(encodePairing(payload));
    expect(parsed.payload).toEqual(payload);
    expect(Buffer.from(parsed.key).equals(Buffer.from(key))).toBe(true);
  });

  it("版本不符或格式錯誤時拋錯", () => {
    expect(() => parsePairing("not json")).toThrow();
    expect(() => parsePairing(JSON.stringify({ v: 2, key: "x", lan: "a", room: "b" }))).toThrow();
  });
});

describe("同步包 AES-256-GCM 加解密", () => {
  it("以一次性金鑰往返加解密", () => {
    const { key } = createPairing("a", "b");
    const plaintext = new TextEncoder().encode("整包 SQLite 與私鑰 🔐");
    const blob = encryptBundle(key, plaintext);
    expect(Buffer.from(decryptBundle(key, blob)).equals(Buffer.from(plaintext))).toBe(true);
  });

  it("每次密文不同（隨機 nonce）", () => {
    const { key } = createPairing("a", "b");
    const pt = new TextEncoder().encode("same");
    expect(Buffer.from(encryptBundle(key, pt)).equals(Buffer.from(encryptBundle(key, pt)))).toBe(false);
  });

  it("錯誤金鑰或遭竄改的密文無法解密", () => {
    const { key } = createPairing("a", "b");
    const blob = encryptBundle(key, new TextEncoder().encode("secret"));
    const { key: wrong } = createPairing("a", "b");
    expect(() => decryptBundle(wrong, blob)).toThrow();
    const tampered = Uint8Array.from(blob);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect(() => decryptBundle(key, tampered)).toThrow();
  });
});

describe("配對協定＋SAS（D4a，ADR-0072）", () => {
  /** 記憶體雙工對接（緩衝註冊前訊息，模擬傳輸層保證）。 */
  function duplexPair(): [PairTransport, PairTransport] {
    const make = () => {
      const queue: Uint8Array[] = [];
      let handler: ((d: Uint8Array) => void) | undefined;
      return {
        deliver(d: Uint8Array) {
          if (handler) handler(d);
          else queue.push(d);
        },
        transport(peer: () => { deliver(d: Uint8Array): void }): PairTransport {
          return {
            send: (d) => peer().deliver(d),
            onMessage(h) {
              handler = h;
              for (const d of queue.splice(0)) h(d);
            },
            close() {},
          };
        },
      };
    };
    const a = make();
    const b = make();
    return [a.transport(() => b), b.transport(() => a)];
  }

  it("端到端：SAS 兩端一致、確認後捆包送達且完整", async () => {
    const { key } = createPairing("", "room");
    const [src, dst] = duplexPair();
    let sasSource = "";
    let sasTarget = "";
    const [sent, json] = await Promise.all([
      runPairingSource(src, key, '{"祕密":"完整歷史"}', async (s) => {
        sasSource = s;
        return true;
      }),
      runPairingTarget(dst, key, (s) => (sasTarget = s)),
    ]);
    expect(sent).toBe(true);
    expect(sasSource).toMatch(/^\d{4}$/);
    expect(sasSource).toBe(sasTarget); // 兩端各自導出、必須一致
    expect(json).toBe('{"祕密":"完整歷史"}');
  });

  it("SAS 不符即拒絕：舊機回 false 不送包、新機收到拒絕即失敗", async () => {
    const { key } = createPairing("", "room");
    const [src, dst] = duplexPair();
    const [sent, target] = await Promise.all([
      runPairingSource(src, key, "secret", async () => false),
      runPairingTarget(dst, key).then(
        () => "resolved",
        (e: Error) => e.message,
      ),
    ]);
    expect(sent).toBe(false);
    expect(target).toContain("拒絕");
  });

  it("金鑰不符（剪貼簿竊取者拿舊載荷）：捆包解密失敗", async () => {
    const { key } = createPairing("", "room");
    const { key: wrongKey } = createPairing("", "room");
    const [src, dst] = duplexPair();
    const results = await Promise.allSettled([
      // source 短逾時：target 解密失敗即斷，source 等不到 DONE 會逾時（真實傳輸則因對端關閉中斷）。
      runPairingSource(src, key, "secret", async () => true, { timeoutMs: 300 }),
      runPairingTarget(dst, wrongKey),
    ]);
    expect(results[1]!.status).toBe("rejected"); // GCM 驗證失敗
  });

  it("deriveSas：4 位數、對（金鑰/nonce）敏感", () => {
    const k1 = new Uint8Array(32).fill(1);
    const k2 = new Uint8Array(32).fill(2);
    const na = new Uint8Array(16).fill(3);
    const nb = new Uint8Array(16).fill(4);
    expect(deriveSas(k1, na, nb)).toMatch(/^\d{4}$/);
    expect(deriveSas(k1, na, nb)).toBe(deriveSas(k1, na, nb)); // 決定性
    expect(deriveSas(k1, na, nb)).not.toBe(deriveSas(k2, na, nb));
    expect(deriveSas(k1, na, nb)).not.toBe(deriveSas(k1, nb, na));
  });
});

describe("配對會合原語（D4a）", () => {
  it("roomKeyFrom：決定性、同鑰同房、異鑰異房", () => {
    const { key } = createPairing("", "r");
    const a = roomKeyFrom(key);
    const b = roomKeyFrom(key);
    expect(a.pk).toBe(b.pk);
    expect(roomKeyFrom(createPairing("", "r").key).pk).not.toBe(a.pk);
  });

  it("sealSignal/openSignal：往返；異鑰/竄改回 null；密文不含明文", () => {
    const { key } = createPairing("", "r");
    const sealed = sealSignal(key, { t: "offer", sdp: "祕密SDP" });
    expect(sealed).not.toContain("祕密SDP");
    expect(openSignal(key, sealed)).toEqual({ t: "offer", sdp: "祕密SDP" });
    expect(openSignal(createPairing("", "r").key, sealed)).toBeNull();
    expect(openSignal(key, sealed.slice(0, -4) + "AAAA")).toBeNull();
  });
});
