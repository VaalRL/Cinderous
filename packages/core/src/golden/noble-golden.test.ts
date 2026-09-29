// 密碼學黃金向量（ADR-0374）：`@noble/*`／`@scure/*` 升級後，**本機既有資料與線上格式逐位元不變**。
//
// fixture `noble-1x-golden.json` 是升級前（@noble/curves 1.9.7、@noble/hashes 1.8.0、
// @scure/base 1.2.6；nostr-tools 自帶 2.0.1）的現行程式產出，由 `noble-golden.ts` 產生。
//
// 兩類斷言：
// 1. **逐位元相同**：固定輸入＋固定亂數下重跑一次，每個欄位都要與 fixture 相同
//    （整則 Gift Wrap、密碼鎖 blob、靜態加密密文、簽章……）。
// 2. **舊產物新程式讀得回**（與亂數無關）：舊事件驗得過、舊密文解得開、舊密碼鎖打得開；
//    竄改或密碼錯一律失敗。這一類即使日後函式庫改了亂數的抽法也仍然成立，
//    它才是「使用者升級後資料還在」的直接證明。

import { readFileSync } from "node:fs";
import { argon2id } from "@noble/hashes/argon2.js";
import { nip44 as ntNip44 } from "nostr-tools";
import { privateKeyFromSeedWords } from "nostr-tools/nip06";
import { describe, expect, it } from "vitest";
import { deriveStorageKey, isSealed, openValue } from "../at-rest.js";
import { parseBackupCode } from "../backup.js";
import { createSha256, decodeFileChunk, sha256Hex } from "../datachannel.js";
import { contentHash, getEventHash, serializeEvent, type NostrEvent } from "../event.js";
import { unwrapMessage } from "../giftwrap.js";
import { hybridConversationKey, pqDecapsulate, pqKeyFromSeed, pqKeyFromStored } from "../hybrid-kem.js";
import { getPublicKey, npubDecode, npubEncode, nsecDecode, nsecEncode } from "../keys.js";
import { conversationKey, decryptWithKey } from "../nip44.js";
import { openWrap } from "../nip59.js";
import { decryptBundle, deriveSas, openSignal, roomKeyFrom } from "../pairing.js";
import { isWrapped, unwrapSecret } from "../passlock-web.js";
import { finalizeEvent, verifyEvent } from "../sign.js";
import {
  counting,
  fromHex,
  generateGolden,
  generateSlowGolden,
  PASSLOCK_ARGON2,
  toHex,
  withFixedRandom,
} from "./noble-golden.js";

const old = JSON.parse(readFileSync(new URL("./noble-1x-golden.json", import.meta.url), "utf8"));
const vectorsRaw = readFileSync(new URL("./nip44.vectors.json", import.meta.url));
const vectors = JSON.parse(vectorsRaw.toString("utf8")).v2;

const sk1 = fromHex(old.keys.sk1);
const sk2 = fromHex(old.keys.sk2);
const { pk1, pk2 } = old.keys as { pk1: string; pk2: string };

/** 把 hex 字串的第一個字元換掉（竄改）。 */
const flipFirst = (s: string) => s.replace(/^./, (c) => (c === "0" ? "1" : "0"));
const utf8 = (s: string) => new TextEncoder().encode(s);

// ── 1. 逐位元相同 ─────────────────────────────────────────────────────────────

describe("黃金向量：固定輸入＋固定亂數，輸出與升級前逐位元相同", () => {
  const now = JSON.parse(JSON.stringify(generateGolden())) as Record<string, unknown>;

  for (const section of ["keys", "event", "nip44", "hybridKem", "nip59", "atRest", "pairing", "datachannel", "group"]) {
    it(section, () => {
      expect(now[section]).toEqual(old[section]);
    });
  }

  it("密碼鎖（Argon2id）與備份碼（NIP-49）", () => {
    const slow = JSON.parse(JSON.stringify(generateSlowGolden()));
    expect(slow.passlock).toEqual(old.passlock);
    expect(slow.backup).toEqual(old.backup);
  }, 60_000);

  it("固定亂數的輔助函式確實還原了原本的亂數來源", () => {
    withFixedRandom(() => undefined);
    const a = crypto.getRandomValues(new Uint8Array(32));
    const b = crypto.getRandomValues(new Uint8Array(32));
    expect(toHex(a)).not.toBe(toHex(b));
    expect(Math.random()).not.toBe(Math.random());
  });
});

// ── 2. 舊產物，新程式讀得回 ───────────────────────────────────────────────────

describe("keys：公鑰、npub／nsec", () => {
  it("固定私鑰導出同一把公鑰；bech32 編解碼來回相同", () => {
    expect(getPublicKey(sk1)).toBe(pk1);
    expect(getPublicKey(sk2)).toBe(pk2);
    expect(npubEncode(pk1)).toBe(old.keys.npub1);
    expect(nsecEncode(sk1)).toBe(old.keys.nsec1);
    expect(npubDecode(old.keys.npub1)).toBe(pk1);
    expect(toHex(nsecDecode(old.keys.nsec1))).toBe(old.keys.sk1);
  });

  it("前綴不符或校驗碼錯誤一律拒絕", () => {
    expect(() => npubDecode(old.keys.nsec1)).toThrow();
    expect(() => nsecDecode(old.keys.npub1)).toThrow();
    expect(() => npubDecode(old.keys.npub1.slice(0, -1) + (old.keys.npub1.endsWith("q") ? "p" : "q"))).toThrow();
  });
});

describe("event／sign：事件 id、BIP-340 簽章、驗章", () => {
  const ev = old.event.signed as NostrEvent;

  it("序列化與 id（sha256）相同", () => {
    const unsigned = { ...old.event.template, pubkey: pk1 };
    expect(serializeEvent(unsigned)).toBe(old.event.serialized);
    expect(getEventHash(unsigned)).toBe(old.event.id);
    expect(ev.id).toBe(old.event.id);
    expect(contentHash("自製貼圖 svg 內容")).toBe(old.event.contentHash);
  });

  it("舊事件驗得過", () => {
    expect(verifyEvent({ ...ev })).toBe(true);
  });

  it("竄改內容、簽章、id、作者都驗不過", () => {
    expect(verifyEvent({ ...ev, content: `${ev.content}!` })).toBe(false);
    expect(verifyEvent({ ...ev, sig: flipFirst(ev.sig) })).toBe(false);
    expect(verifyEvent({ ...ev, id: flipFirst(ev.id) })).toBe(false);
    expect(verifyEvent({ ...ev, pubkey: pk2 })).toBe(false);
  });

  it("格式錯誤的 sig／pubkey 回 false 而不是拋錯", () => {
    expect(verifyEvent({ ...ev, sig: "zz" })).toBe(false);
    expect(verifyEvent({ ...ev, sig: ev.sig.slice(0, 126) })).toBe(false);
    expect(verifyEvent({ ...ev, sig: `${ev.sig}0` })).toBe(false);
    expect(verifyEvent({ ...ev, sig: "" })).toBe(false);
    const badPk = { ...ev, pubkey: "ff".repeat(32) };
    expect(verifyEvent({ ...badPk, id: getEventHash(badPk) })).toBe(false);
  });

  it("新簽的事件（真亂數）id 相同、驗得過", () => {
    const fresh = finalizeEvent({ ...old.event.template }, sk1);
    expect(fresh.id).toBe(old.event.id);
    expect(fresh.pubkey).toBe(pk1);
    expect(verifyEvent(fresh)).toBe(true);
  });
});

describe("NIP-44（nostr-tools）", () => {
  it("對話金鑰雙向相同；舊密文解得開", () => {
    expect(toHex(conversationKey(sk1, pk2))).toBe(old.nip44.conversationKey);
    expect(toHex(conversationKey(sk2, pk1))).toBe(old.nip44.conversationKey);
    expect(decryptWithKey(old.nip44.payload, fromHex(old.nip44.conversationKey))).toBe("NIP-44 黃金向量：固定 nonce");
  });

  it("官方測試向量檔未被改動（SHA-256 與 NIP-44 規格公布的一致）", () => {
    expect(sha256Hex(new Uint8Array(vectorsRaw))).toBe("269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040");
  });

  it("官方向量 get_conversation_key", () => {
    for (const v of vectors.valid.get_conversation_key) {
      expect(toHex(conversationKey(fromHex(v.sec1), v.pub2))).toBe(v.conversation_key);
    }
  });

  it("官方向量 encrypt_decrypt：固定 nonce 逐位元相同，雙向解得開", () => {
    for (const v of vectors.valid.encrypt_decrypt) {
      const ck = conversationKey(fromHex(v.sec1), getPublicKey(fromHex(v.sec2)));
      expect(toHex(ck)).toBe(v.conversation_key);
      expect(ntNip44.v2.encrypt(v.plaintext, ck, fromHex(v.nonce))).toBe(v.payload);
      expect(decryptWithKey(v.payload, ck)).toBe(v.plaintext);
      expect(decryptWithKey(v.payload, conversationKey(fromHex(v.sec2), getPublicKey(fromHex(v.sec1))))).toBe(v.plaintext);
    }
  });

  it("官方向量 encrypt_decrypt_long_msg（雜湊）", () => {
    for (const v of vectors.valid.encrypt_decrypt_long_msg) {
      const plaintext = (v.pattern as string).repeat(v.repeat);
      expect(sha256Hex(utf8(plaintext))).toBe(v.plaintext_sha256);
      const payload = ntNip44.v2.encrypt(plaintext, fromHex(v.conversation_key), fromHex(v.nonce));
      expect(sha256Hex(utf8(payload))).toBe(v.payload_sha256);
      expect(decryptWithKey(payload, fromHex(v.conversation_key))).toBe(plaintext);
    }
  });

  it("官方向量 calc_padded_len", () => {
    for (const [len, padded] of vectors.valid.calc_padded_len) {
      expect(ntNip44.v2.utils.calcPaddedLen(len)).toBe(padded);
    }
  });

  it("官方向量 invalid：不合法金鑰與竄改密文一律拒絕", () => {
    for (const v of vectors.invalid.get_conversation_key) {
      expect(() => conversationKey(fromHex(v.sec1), v.pub2), v.note).toThrow();
    }
    for (const v of vectors.invalid.decrypt) {
      expect(() => decryptWithKey(v.payload, fromHex(v.conversation_key)), v.note).toThrow();
    }
  });
});

describe("NIP-59／NIP-17：舊 Gift Wrap 解得開", () => {
  it("純古典：寄件人、內容、seal tags 都對", () => {
    const opened = openWrap(old.nip59.giftWrapClassic, sk2);
    expect(opened.sender).toBe(pk1);
    expect(opened.rumor.content).toBe("NIP-59 黃金向量（古典）");
    expect(opened.sealTags).toEqual([["ek", pk1]]);
    expect(verifyEvent(old.nip59.giftWrapClassic)).toBe(true);
  });

  it("混合式（ML-KEM）：以同一顆種子展開的私鑰解得開；少了 ML-KEM 私鑰則拒絕", () => {
    const pq = pqKeyFromStored(old.hybridKem.seed);
    expect(pq).toBeDefined();
    const opened = openWrap(old.nip59.giftWrapPq, { sk: sk2, pqSk: pq!.sk });
    expect(opened.sender).toBe(pk1);
    expect(opened.rumor.content).toBe("NIP-59 黃金向量（混合式 ML-KEM）");
    expect(() => openWrap(old.nip59.giftWrapPq, sk2)).toThrow();
  });

  it("竄改外層內容即拒絕", () => {
    const w = old.nip59.giftWrapClassic as NostrEvent;
    const content = w.content.slice(0, 10) + (w.content[10] === "A" ? "B" : "A") + w.content.slice(11);
    expect(() => openWrap({ ...w, content }, sk2)).toThrow();
  });

  it("App 私訊入口（wrapMessage）：對方與自封副本都解得開，rumor id 相同", () => {
    const dm = old.nip59.dm as { id: string; events: NostrEvent[]; selfCopy: NostrEvent };
    const toPeer = unwrapMessage(dm.events[0]!, sk2);
    const self = unwrapMessage(dm.selfCopy, sk1);
    expect(toPeer.sender).toBe(pk1);
    expect(toPeer.rumor.content).toBe("NIP-17 私訊黃金向量");
    expect(toPeer.rumor.id).toBe(dm.id);
    expect(self.rumor.id).toBe(dm.id);
  });
});

describe("hybrid-kem：ML-KEM-768 與混合 KDF", () => {
  it("固定種子導出同一對金鑰；舊密文解出同一個共享祕密", () => {
    const kp = pqKeyFromSeed(counting(64));
    expect(sha256Hex(kp.pk)).toBe(old.hybridKem.pkSha256);
    expect(sha256Hex(kp.sk)).toBe(old.hybridKem.skSha256);
    expect(toHex(pqDecapsulate(kp.sk, fromHex(old.hybridKem.ct)))).toBe(old.hybridKem.ss);
  });

  it("混合 KDF（HKDF-SHA256）對固定輸入導出同一把", () => {
    const args = { ssClassic: fromHex(old.hybridKem.ssClassic), ssPq: fromHex(old.hybridKem.ss), ct: fromHex(old.hybridKem.ct) };
    expect(toHex(hybridConversationKey({ ...args, layer: "seal" }))).toBe(old.hybridKem.hybridSeal);
    expect(toHex(hybridConversationKey({ ...args, layer: "wrap" }))).toBe(old.hybridKem.hybridWrap);
  });
});

describe("at-rest：本機既有 `c1:` 資料讀得回", () => {
  it("由 nsec 導出同一把儲存金鑰（HKDF-SHA256）", () => {
    expect(toHex(deriveStorageKey(sk1))).toBe(old.atRest.storageKey);
  });

  it("舊密文解得回原文；金鑰錯或竄改回 null；無前綴的舊明文原樣回傳", () => {
    const key = deriveStorageKey(sk1);
    expect(isSealed(old.atRest.sealed)).toBe(true);
    expect(openValue(key, old.atRest.sealed)).toBe(old.atRest.plaintext);
    expect(openValue(deriveStorageKey(sk2), old.atRest.sealed)).toBeNull();
    const s = old.atRest.sealed as string;
    const tampered = s.slice(0, -4) + (s.slice(-4, -3) === "A" ? "B" : "A") + s.slice(-3);
    expect(openValue(key, tampered)).toBeNull();
    expect(openValue(key, "舊的明文值")).toBe("舊的明文值");
  });
});

describe("passlock：既有密碼鎖打得開（Argon2id）", () => {
  it("blob 記錄的就是 App 的參數；以該參數的原始 Argon2id 輸出相同", () => {
    const blob = JSON.parse(old.passlock.blob);
    expect({ m: blob.m, t: blob.t, p: blob.p }).toEqual({ m: PASSLOCK_ARGON2.m, t: PASSLOCK_ARGON2.t, p: PASSLOCK_ARGON2.p });
    const raw = argon2id(utf8(old.passlock.password), counting(32), { ...PASSLOCK_ARGON2 });
    expect(toHex(raw)).toBe(old.passlock.argon2Raw);
  }, 30_000);

  it("正確密碼解鎖成功", () => {
    expect(isWrapped(old.passlock.blob)).toBe(true);
    expect(unwrapSecret(old.passlock.password, old.passlock.blob)).toBe(old.passlock.plaintext);
  }, 30_000);

  it("密碼錯誤或 blob 遭竄改回 null", () => {
    expect(unwrapSecret(`${old.passlock.password}x`, old.passlock.blob)).toBeNull();
    const blob = JSON.parse(old.passlock.blob);
    const d = blob.data as string;
    const tampered = JSON.stringify({ ...blob, data: (d.startsWith("A") ? "B" : "A") + d.slice(1) });
    expect(unwrapSecret(old.passlock.password, tampered)).toBeNull();
    // 換鹽＝換 KEK ⇒ 也打不開（證明鹽真的有進 KDF）
    const s = blob.salt as string;
    const otherSalt = JSON.stringify({ ...blob, salt: (s.startsWith("A") ? "B" : "A") + s.slice(1) });
    expect(unwrapSecret(old.passlock.password, otherSalt)).toBeNull();
  }, 60_000);
});

describe("pairing（AES-256-GCM）", () => {
  const key = () => fromHex(old.pairing.key);

  it("舊捆包與舊信令解得開", () => {
    expect(new TextDecoder().decode(decryptBundle(key(), fromHex(old.pairing.bundle)))).toBe("配對捆包黃金向量");
    expect(openSignal(key(), old.pairing.signal)).toEqual({ t: "offer", sdp: "v=0" });
    expect(openSignal(counting(32), old.pairing.signal)).toBeNull();
  });

  it("竄改捆包即拋（GCM 驗證失敗）", () => {
    const b = fromHex(old.pairing.bundle);
    b[b.length - 1] = b[b.length - 1]! ^ 1;
    expect(() => decryptBundle(key(), b)).toThrow();
  });

  it("SAS 短碼與房間金鑰相同", () => {
    expect(deriveSas(key(), counting(16, 1), counting(16, 0x21))).toBe(old.pairing.sas);
    const room = roomKeyFrom(key());
    expect(toHex(room.sk)).toBe(old.pairing.roomSk);
    expect(room.pk).toBe(old.pairing.roomPk);
  });
});

describe("datachannel：分塊框架與檔案校驗", () => {
  it("舊分塊解得開；整檔與逐段 SHA-256 相同", () => {
    const bytes = counting(300, 3);
    const decoded = decodeFileChunk(fromHex(old.datachannel.chunk));
    expect(decoded?.id).toBe("tid-golden");
    expect(decoded?.seq).toBe(7);
    expect(toHex(decoded!.bytes)).toBe(toHex(bytes));
    expect(sha256Hex(bytes)).toBe(old.datachannel.sha256);
    const h = createSha256();
    h.update(bytes.subarray(0, 1));
    h.update(bytes.subarray(1));
    expect(h.hex()).toBe(old.datachannel.incremental);
    expect(old.datachannel.incremental).toBe(old.datachannel.sha256);
  });
});

describe("backup（NIP-49：scrypt＋XChaCha20-Poly1305，nostr-tools）", () => {
  it("舊備份碼以正確密碼還原；密碼錯誤即拋", () => {
    expect(parseBackupCode(old.backup.code, old.backup.password)).toEqual({ nsec: old.keys.nsec1, relayUrl: old.backup.relayUrl });
    expect(() => parseBackupCode(old.backup.code, `${old.backup.password}x`)).toThrow();
  }, 60_000);
});

describe("相依完整性：nostr-tools 經 overrides 後仍完整可用", () => {
  it("NIP-06（@scure/bip32／bip39）：助記詞導出同一把私鑰（與 Cinderous SDK 的 v0.28 產物一致）", () => {
    // 只覆寫 @scure/base 而漏掉 bip39 時，這個模組在**載入時**就會拋（SDK ADR 0034 Decision 2）。
    const mnemonic = "leader monkey parrot ring guide accident before fence cannon height naive bean";
    expect(toHex(privateKeyFromSeedWords(mnemonic, undefined, 0))).toBe(old.keys.sk1);
  });
});
