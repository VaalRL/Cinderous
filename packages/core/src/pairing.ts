import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";

/**
 * QR Code 配對載荷：僅含「一次性 AES-256-GCM 金鑰、內網 IP、WebRTC 房間號」。
 * 不含任何明文資料；掃描後雙方以該金鑰建立 AEAD 通道傳輸 SQLite 與私鑰。
 */
export interface PairingPayload {
  v: 1;
  /** base64 編碼的 32-byte AES-256 金鑰。 */
  key: string;
  /** 內網 IP（LAN 直連用）。 */
  lan: string;
  /** WebRTC 房間號（WAN 打洞用）。 */
  room: string;
}

const KEY_BYTES = 32;
const NONCE_BYTES = 12;

/** 產生一份新的配對載荷與其原始一次性金鑰（金鑰用後即焚）。 */
export function createPairing(lan: string, room: string): { payload: PairingPayload; key: Uint8Array } {
  const key = randomBytes(KEY_BYTES);
  return { payload: { v: 1, key: base64.encode(key), lan, room }, key };
}

/** 將配對載荷編碼為 QR 內容字串。 */
export function encodePairing(payload: PairingPayload): string {
  return JSON.stringify(payload);
}

/** 解析 QR 內容；版本不符或格式錯誤時拋錯。 */
export function parsePairing(qr: string): { payload: PairingPayload; key: Uint8Array } {
  const payload = JSON.parse(qr) as PairingPayload;
  if (payload.v !== 1 || typeof payload.key !== "string") {
    throw new Error("配對載荷版本不符或格式錯誤");
  }
  const key = base64.decode(payload.key);
  if (key.length !== KEY_BYTES) throw new Error("配對金鑰長度錯誤");
  return { payload, key };
}

/** 以一次性金鑰 AES-256-GCM 加密同步包；輸出為 `nonce || ciphertext`。 */
export function encryptBundle(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(NONCE_BYTES + ciphertext.length);
  out.set(nonce);
  out.set(ciphertext, NONCE_BYTES);
  return out;
}

/** 解密 `nonce || ciphertext`；金鑰錯誤或遭竄改時拋錯（GCM 驗證失敗）。 */
export function decryptBundle(key: Uint8Array, blob: Uint8Array): Uint8Array {
  const nonce = blob.subarray(0, NONCE_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES);
  return gcm(key, nonce).decrypt(ciphertext);
}

// ── 配對協定（D4a，ADR-0072）：SAS 互認＋捆包傳送 ─────────────────────────────
//
// 訊框：`type(1B) ‖ payload`。流程（新機＝target 發起、舊機＝source 授權）：
//   target → HELLO(nonceB) → source → CHALLENGE(nonceA) → 兩端各自導出 SAS 四位短碼
//   → 舊機使用者確認相符 → BUNDLE(AEAD 捆包) → target 套用 → DONE。
// SAS 綁定（金鑰＋本次連線的雙方 nonce）：剪貼簿竊取者即使拿到載荷，其連線的
// SAS 與新機顯示的不同（或新機根本連不上一次性房間）→ 使用者拒絕即斷。

import { sha256 } from "@noble/hashes/sha256";

/** 協定訊框類型。 */
const FRAME = { HELLO: 1, CHALLENGE: 2, BUNDLE: 3, DONE: 4, REJECT: 5 } as const;
const NONCE_LEN = 16;
/** 協定步驟逾時（ms）。 */
const STEP_TIMEOUT_MS = 120_000;

/** 配對傳輸抽象：雙工位元組流；訊息保證完整（分塊由傳輸實作組回）。 */
export interface PairTransport {
  send(data: Uint8Array): void;
  /** 註冊收訊回呼（單一）；實作須緩衝註冊前抵達的訊息。 */
  onMessage(handler: (data: Uint8Array) => void): void;
  close(): void;
}

/** 自（一次性金鑰＋雙方 nonce）導出 4 位 SAS 短碼（兩端各自計算、人工比對）。 */
export function deriveSas(key: Uint8Array, nonceA: Uint8Array, nonceB: Uint8Array): string {
  const digest = sha256(new Uint8Array([...key, ...nonceA, ...nonceB]));
  const n = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return String(n % 10_000).padStart(4, "0");
}

function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

/** 依序收取訊框的收件匣（含逾時）。 */
function makeInbox(transport: PairTransport, timeoutMs: number) {
  const queue: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  transport.onMessage((data) => {
    queue.push(data);
    wake?.();
  });
  return async function next(expectType: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const msg = queue.shift();
      if (msg) {
        if (msg[0] === FRAME.REJECT) throw new Error("對方拒絕配對");
        if (msg[0] !== expectType) throw new Error(`配對協定錯誤：預期訊框 ${expectType}、收到 ${msg[0]}`);
        return msg.subarray(1);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("配對逾時");
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, Math.min(remaining, 250));
      });
    }
  };
}

/**
 * 舊機（資料持有方）角色：等 HELLO → 送 CHALLENGE → `confirmSas` 使用者確認
 * 相符後送出 AEAD 捆包 → 等 DONE。使用者拒絕＝送 REJECT 並回 false（不送包）。
 */
export async function runPairingSource(
  transport: PairTransport,
  key: Uint8Array,
  bundleJson: string,
  confirmSas: (sas: string) => Promise<boolean>,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const next = makeInbox(transport, opts.timeoutMs ?? STEP_TIMEOUT_MS);
  try {
    const nonceB = await next(FRAME.HELLO);
    const nonceA = randomBytes(NONCE_LEN);
    transport.send(frame(FRAME.CHALLENGE, nonceA));
    const sas = deriveSas(key, nonceA, nonceB);
    if (!(await confirmSas(sas))) {
      transport.send(frame(FRAME.REJECT, new Uint8Array()));
      return false;
    }
    transport.send(frame(FRAME.BUNDLE, encryptBundle(key, new TextEncoder().encode(bundleJson))));
    await next(FRAME.DONE);
    return true;
  } finally {
    transport.close();
  }
}

/**
 * 新機（發起方）角色：送 HELLO → 收 CHALLENGE → `onSas` 顯示短碼供人工比對
 * → 收捆包解密回傳（JSON 字串）→ 回 DONE。解密失敗（金鑰不符/竄改）拋錯。
 */
export async function runPairingTarget(
  transport: PairTransport,
  key: Uint8Array,
  onSas?: (sas: string) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const next = makeInbox(transport, opts.timeoutMs ?? STEP_TIMEOUT_MS);
  try {
    const nonceB = randomBytes(NONCE_LEN);
    transport.send(frame(FRAME.HELLO, nonceB));
    const nonceA = await next(FRAME.CHALLENGE);
    onSas?.(deriveSas(key, nonceA, nonceB));
    const cipher = await next(FRAME.BUNDLE);
    const json = new TextDecoder().decode(decryptBundle(key, cipher));
    transport.send(frame(FRAME.DONE, new Uint8Array()));
    return json;
  } finally {
    transport.close();
  }
}
