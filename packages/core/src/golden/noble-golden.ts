// 密碼學黃金向量（ADR-0374）：把 `@noble/*`／`@scure/*` 升級前的**實際輸出**釘成 fixture。
//
// ## 為什麼要有這個檔
//
// 升級密碼學函式庫最怕的不是「編不過」，而是**編得過、測試也綠，但位元組悄悄變了**：
// - 密碼鎖（Argon2id）導出不同的 KEK ⇒ 使用者**再也打不開**自己的密碼鎖；
// - 靜態加密（HKDF）導出不同的儲存金鑰 ⇒ 本機所有 `c1:` 資料**讀不回來**；
// - 簽章、事件 id、NIP-44 密文、Gift Wrap 格式變了 ⇒ 新舊版 App **互不相通**。
// 這些錯誤各自的單元測試都抓不到——每個模組自己跟自己來回，永遠對得上。
//
// ## 做法
//
// 1. **固定所有輸入**（私鑰、密碼、鹽、明文）。
// 2. **固定亂數**：`withFixedRandom` 暫時換掉 `crypto.getRandomValues` 與 `Math.random`，
//    讓「本來每次都不同」的輸出（nonce、auxRand、一次性 wrap 金鑰、ML-KEM 封裝亂數、
//    NIP-59 時戳抖動）也變成確定性的 ⇒ **整則 Gift Wrap、整個密碼鎖 blob 都能逐位元比對**。
//    亂數只取決於「要幾個位元組」，不取決於呼叫次數——函式庫內部多抽幾次亂數
//    （例如 noble 2.3 起的純量盲化）不會把後面的值擠歪。
// 3. `generateGolden()` 在**升級前**（noble 1.x）跑一次寫成 `noble-1x-golden.json` 進版控；
//    升級後 `noble-golden.test.ts` 用新版重跑，要求逐位元相同，並用新版去**解舊產物**。
//
// ⚠ 本檔只供測試與 fixture 產生使用，不從 `index.ts` 匯出。

import { argon2id } from "@noble/hashes/argon2.js";
import { decryptBundle, deriveSas, encryptBundle, roomKeyFrom, sealSignal } from "../pairing.js";
import { deriveStorageKey, sealValue } from "../at-rest.js";
import { wrapSecret } from "../passlock-web.js";
import { makeBackupCode } from "../backup.js";
import { createSha256, encodeFileChunk, sha256Hex } from "../datachannel.js";
import { contentHash, getEventHash, serializeEvent } from "../event.js";
import { newGroupId } from "../group.js";
import { wrapMessage } from "../giftwrap.js";
import {
  hybridConversationKey,
  pqDecapsulate,
  pqEncapsulate,
  pqKeyFromSeed,
  encodePqSeed,
} from "../hybrid-kem.js";
import { generateSecretKey, getPublicKey, npubEncode, nsecEncode } from "../keys.js";
import { conversationKey, encryptWithKey } from "../nip44.js";
import { sealAndWrap } from "../nip59.js";
import { finalizeEvent } from "../sign.js";

// ── 固定輸入 ────────────────────────────────────────────────────────────────

/** 與 Cinderous SDK 的 noble 相容性產物同一組私鑰（SDK ADR 0034），方便交叉比對。 */
export const SK1_HEX = "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a";
export const SK2_HEX = "c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add";
export const CREATED_AT = 1_790_000_000;
export const PASSLOCK_PASSWORD = "cinder-密碼鎖-🔥";
export const BACKUP_PASSWORD = "cinder-備份碼";
export const AT_REST_PLAINTEXT = JSON.stringify({ convo: "黃金向量", n: 42, emoji: "🔥" });
export const RELAY_URL = "wss://cinder-relay.example.workers.dev";

/** 本檔自帶的 hex 工具——刻意不用受測的函式庫，fixture 才不會跟著它一起變。 */
export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0) throw new Error("hex 長度必須是偶數");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 0,1,2,… 的序列（固定的鹽、種子、金鑰）。 */
export function counting(len: number, start = 0): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) out[i] = (start + i) & 0xff;
  return out;
}

// ── 固定亂數 ────────────────────────────────────────────────────────────────

/** 決定性「亂數」：只取決於長度與位置（不取決於第幾次呼叫，見檔頭）。 */
function fill(arr: Uint8Array): void {
  for (let i = 0; i < arr.length; i += 1) arr[i] = (i * 29 + arr.length * 13 + 7) & 0xff;
}

/**
 * 在「亂數固定」的環境裡執行 `fn`，結束後一定還原。
 *
 * noble 1.x 與 2.x 的 `randomBytes` 都是在**呼叫當下**讀 `globalThis.crypto.getRandomValues`，
 * nostr-tools、`@noble/post-quantum` 也都經過它 ⇒ 換掉這一個方法就涵蓋整條路徑。
 * `Math.random` 只用在 NIP-59 的時戳抖動。
 */
export function withFixedRandom<T>(fn: () => T): T {
  type Grv = <A extends ArrayBufferView | null>(arr: A) => A;
  const c = globalThis.crypto as unknown as { getRandomValues: Grv };
  const hadOwn = Object.prototype.hasOwnProperty.call(c, "getRandomValues");
  const origGrv = c.getRandomValues;
  const origRandom = Math.random;
  c.getRandomValues = <A extends ArrayBufferView | null>(arr: A): A => {
    if (arr) fill(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
    return arr;
  };
  Math.random = () => 0.25;
  try {
    return fn();
  } finally {
    if (hadOwn) c.getRandomValues = origGrv;
    else delete (c as { getRandomValues?: unknown }).getRandomValues;
    Math.random = origRandom;
  }
}

// ── 產生 ────────────────────────────────────────────────────────────────────

/**
 * 以現行程式產生全部黃金向量。
 *
 * `slow: false` 時略過 Argon2id（m=19 MiB）與 NIP-49（scrypt N=2^16）——
 * 那兩項各要數百毫秒到數秒，其餘向量都是毫秒級。
 */
export function generateGolden() {
  const sk1 = fromHex(SK1_HEX);
  const sk2 = fromHex(SK2_HEX);
  const pk1 = getPublicKey(sk1);
  const pk2 = getPublicKey(sk2);

  return withFixedRandom(() => {
    // keys
    const generatedSk = toHex(generateSecretKey());

    // event / sign
    const template = {
      kind: 1,
      created_at: CREATED_AT,
      tags: [["t", "cinderous"], ["p", pk2]],
      content: "noble 1.x → 2.4 黃金向量 🔥\n\"引號\"\\反斜線\t",
    };
    const event = finalizeEvent(template, sk1);
    const serialized = serializeEvent({ ...template, pubkey: pk1 });

    // NIP-44
    const ck = conversationKey(sk1, pk2);
    const nip44Payload = encryptWithKey("NIP-44 黃金向量：固定 nonce", ck);

    // hybrid-kem（固定種子）
    const pqSeed = counting(64);
    const pq = pqKeyFromSeed(pqSeed);
    const enc = pqEncapsulate(pq.pk);
    const ssClassic = counting(32, 0x40);
    const hybridSeal = hybridConversationKey({ ssClassic, ssPq: enc.ss, ct: enc.ct, layer: "seal" });
    const hybridWrap = hybridConversationKey({ ssClassic, ssPq: enc.ss, ct: enc.ct, layer: "wrap" });

    // NIP-59：純古典與混合式各一則；再來一則走 App 真正的私訊入口（NIP-17 wrapMessage）
    const rumor = { kind: 14, created_at: CREATED_AT, tags: [["p", pk2]], content: "NIP-59 黃金向量（古典）" };
    const giftWrapClassic = sealAndWrap(rumor, sk1, pk2, { kind: 1059, tags: [["p", pk2]] }, [["ek", pk1]]);
    const giftWrapPq = sealAndWrap(
      { ...rumor, content: "NIP-59 黃金向量（混合式 ML-KEM）" },
      sk1,
      { pk: pk2, pq: pq.pk },
      { kind: 1059, tags: [["p", pk2]], created_at: CREATED_AT },
    );
    const dm = wrapMessage("NIP-17 私訊黃金向量", sk1, pk2, { now: CREATED_AT, relayHint: RELAY_URL });

    // at-rest
    const storageKey = deriveStorageKey(sk1);
    const sealed = sealValue(storageKey, AT_REST_PLAINTEXT);

    // pairing
    const pairKey = counting(32, 0x80);
    const bundle = encryptBundle(pairKey, new TextEncoder().encode("配對捆包黃金向量"));
    const sas = deriveSas(pairKey, counting(16, 1), counting(16, 0x21));
    const room = roomKeyFrom(pairKey);
    const signal = sealSignal(pairKey, { t: "offer", sdp: "v=0" });

    // datachannel
    const chunkBytes = counting(300, 3);
    const chunk = encodeFileChunk("tid-golden", 7, chunkBytes);
    const inc = createSha256();
    inc.update(chunkBytes.subarray(0, 100));
    inc.update(chunkBytes.subarray(100));

    return {
      _meta: {
        note: "noble 1.x 時期由 packages/core/src/golden/noble-golden.ts 產生（ADR-0374）；升級後必須逐位元相同",
      },
      keys: {
        sk1: SK1_HEX,
        sk2: SK2_HEX,
        pk1,
        pk2,
        npub1: npubEncode(pk1),
        nsec1: nsecEncode(sk1),
        generatedSk,
      },
      event: {
        template,
        serialized,
        id: getEventHash({ ...template, pubkey: pk1 }),
        signed: event,
        contentHash: contentHash("自製貼圖 svg 內容"),
      },
      nip44: { conversationKey: toHex(ck), payload: nip44Payload },
      hybridKem: {
        seed: encodePqSeed(pqSeed),
        pkSha256: sha256Hex(pq.pk),
        skSha256: sha256Hex(pq.sk),
        ct: toHex(enc.ct),
        ss: toHex(enc.ss),
        decapsulated: toHex(pqDecapsulate(pq.sk, enc.ct)),
        ssClassic: toHex(ssClassic),
        hybridSeal: toHex(hybridSeal),
        hybridWrap: toHex(hybridWrap),
      },
      nip59: { giftWrapClassic, giftWrapPq, dm },
      atRest: { storageKey: toHex(storageKey), plaintext: AT_REST_PLAINTEXT, sealed },
      pairing: {
        key: toHex(pairKey),
        bundle: toHex(bundle),
        bundleRoundTrip: new TextDecoder().decode(decryptBundle(pairKey, bundle)),
        sas,
        roomSk: toHex(room.sk),
        roomPk: room.pk,
        signal,
      },
      datachannel: {
        chunk: toHex(chunk),
        sha256: sha256Hex(chunkBytes),
        incremental: inc.hex(),
      },
      group: { newGroupId: newGroupId() },
    };
  });
}

/**
 * 密碼鎖實際使用的 Argon2id 參數（與 `passlock-web.ts`、桌面 `passlock.rs` 相同）。
 * 測試會核對 blob 裡記錄的參數等於這組，確保下面的原始雜湊向量測的就是 App 那一組。
 */
export const PASSLOCK_ARGON2 = { m: 19_456, t: 2, p: 1, dkLen: 32 } as const;

/** 慢的兩項（Argon2id 密碼鎖、NIP-49 備份碼），分開產生。 */
export function generateSlowGolden() {
  const sk1 = fromHex(SK1_HEX);
  return withFixedRandom(() => ({
    passlock: {
      password: PASSLOCK_PASSWORD,
      plaintext: nsecEncode(sk1),
      blob: wrapSecret(PASSLOCK_PASSWORD, nsecEncode(sk1)),
      /** Argon2id(App 參數, 固定密碼, 鹽 = 0..31) 的原始輸出。 */
      argon2Raw: toHex(argon2id(new TextEncoder().encode(PASSLOCK_PASSWORD), counting(32), { ...PASSLOCK_ARGON2 })),
    },
    backup: {
      password: BACKUP_PASSWORD,
      relayUrl: RELAY_URL,
      code: makeBackupCode(nsecEncode(sk1), RELAY_URL, BACKUP_PASSWORD),
    },
  }));
}
