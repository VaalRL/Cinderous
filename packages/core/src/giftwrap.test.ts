import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { getEventHash } from "./event.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { encryptDM } from "./nip44.js";
import { finalizeEvent } from "./sign.js";
import {
  messageExpiry,
  parseFileMeta,
  relayHintOf,
  selfCopyTarget,
  unwrapMessage,
  wrapFileMessage,
  wrapMessage,
} from "./giftwrap.js";
import { isMentioned, mentionedPubkeys } from "./mention.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

// ADR-0107 起，wrap* 會同時產出「給對方」與「自封副本」兩份 wrap。
// 以下既有測試檢驗的是**給對方**那一份，故取 events[0]；自封副本另有專門的 describe。
const dm = (...args: Parameters<typeof wrapMessage>) => wrapMessage(...args).events[0]!;
const fileDm = (...args: Parameters<typeof wrapFileMessage>) => wrapFileMessage(...args).events[0]!;

describe("NIP-17/59 Gift Wrap 離線私訊", () => {
  it("收件人可還原內容與寄件人身分", () => {
    const wrap = dm("晚點打給你 🤙", aliceSk, bobPk, { now: 1_700_000_000 });
    const { sender, rumor } = unwrapMessage(wrap, bobSk);
    expect(sender).toBe(alicePk);
    expect(rumor.content).toBe("晚點打給你 🤙");
    expect(rumor.kind).toBe(14);
    expect(rumor.created_at).toBe(1_700_000_000);
  });

  it("外層為 kind 1059、帶 #p 收件人與 NIP-40 過期，且作者非寄件人（隱藏社交圖譜）", () => {
    const now = 1_700_000_000;
    const wrap = dm("hi", aliceSk, bobPk, { now });
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    expect(wrap.tags).toContainEqual(["p", bobPk]);
    const exp = wrap.tags.find((t) => t[0] === "expiration");
    expect(exp).toBeDefined();
    expect(Number(exp?.[1])).toBe(now + 7 * 86400);
    // 外層作者為一次性金鑰，不可洩漏寄件人 Alice
    expect(wrap.pubkey).not.toBe(alicePk);
  });

  it("可自訂過期時間", () => {
    const wrap = dm("hi", aliceSk, bobPk, { now: 1000, expiration: 1234 });
    expect(wrap.tags.find((t) => t[0] === "expiration")?.[1]).toBe("1234");
  });

  it("限時訊息：rumor 內帶到期 tag，外層 wrap 過期同時縮短", () => {
    const now = 1_700_000_000;
    const disappearAt = now + 60;
    const wrap = dm("閱後即焚", aliceSk, bobPk, { now, disappearAt });
    // 外層 wrap 過期縮短為到期時間（利於中繼清除）
    expect(Number(wrap.tags.find((t) => t[0] === "expiration")?.[1])).toBe(disappearAt);
    // 收件端解密後可從 rumor 讀出到期時間
    const { rumor } = unwrapMessage(wrap, bobSk);
    expect(messageExpiry(rumor)).toBe(disappearAt);
  });

  it("一般訊息 rumor 不帶到期 tag（messageExpiry 為 undefined）", () => {
    const { rumor } = unwrapMessage(dm("hi", aliceSk, bobPk), bobSk);
    expect(messageExpiry(rumor)).toBeUndefined();
  });

  it("relay hint（ADR-0035）：寫進 rumor 內層、外層不可見，收件端可讀出", () => {
    const wrap = dm("hi", aliceSk, bobPk, { relayHint: "wss://x" });
    // 外層 wrap 與其 tags 不含 hint（只有 p 與 expiration）
    expect(JSON.stringify(wrap.tags)).not.toContain("wss://x");
    const { rumor } = unwrapMessage(wrap, bobSk);
    expect(relayHintOf(rumor)).toBe("wss://x");
    // 未帶 hint 時為 undefined
    expect(relayHintOf(unwrapMessage(dm("hi", aliceSk, bobPk), bobSk).rumor)).toBeUndefined();
  });

  it("大內容（~33KB，自製貼圖 v2 規模）可完整 wrap/unwrap（ADR-0032）", () => {
    const big = `nb-sticker:v2:{"label":"大","svg":"<svg>${"a".repeat(32 * 1024)}</svg>"}`;
    const wrap = dm(big, aliceSk, bobPk);
    const { rumor } = unwrapMessage(wrap, bobSk);
    expect(rumor.content).toBe(big);
  });

  it("第三者無法解開", () => {
    const wrap = dm("for bob", aliceSk, bobPk);
    const eveSk = generateSecretKey();
    expect(() => unwrapMessage(wrap, eveSk)).toThrow();
  });

  describe("檔案 metadata 訊息（ADR-0093）", () => {
    const meta = { tid: "f123_0", name: "報告.pdf", size: 20480, mime: "application/pdf" };

    it("收件端可從加密內層還原檔案 metadata（tid/name/size/mime）", () => {
      const wrap = fileDm(aliceSk, bobPk, meta, { now: 1_700_000_000 });
      const { sender, rumor } = unwrapMessage(wrap, bobSk);
      expect(sender).toBe(alicePk);
      expect(parseFileMeta(rumor)).toEqual(meta);
    });

    it("外層為 kind 1059、帶 #p 收件人；metadata 不外洩（中繼看不到檔名/tid）", () => {
      const wrap = fileDm(aliceSk, bobPk, meta);
      expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
      expect(wrap.tags).toContainEqual(["p", bobPk]);
      expect(JSON.stringify(wrap.tags)).not.toContain("報告.pdf");
      expect(JSON.stringify(wrap.tags)).not.toContain(meta.tid);
    });

    it("relay hint 隨檔案訊息寫進內層、外層不可見", () => {
      const wrap = fileDm(aliceSk, bobPk, meta, { relayHint: "wss://home" });
      expect(JSON.stringify(wrap.tags)).not.toContain("wss://home");
      expect(relayHintOf(unwrapMessage(wrap, bobSk).rumor)).toBe("wss://home");
    });

    it("一般文字訊息 parseFileMeta 為 null（非檔案訊息不誤判）", () => {
      const { rumor } = unwrapMessage(dm("只是文字", aliceSk, bobPk), bobSk);
      expect(parseFileMeta(rumor)).toBeNull();
    });

    it("儲存槽存放標記（ADR-0161）：slot round-trip；一般檔案訊息無 slot 欄位", () => {
      const wrap = fileDm(aliceSk, bobPk, { ...meta, slot: "與阿強的對話" });
      const out = parseFileMeta(unwrapMessage(wrap, bobSk).rumor);
      expect(out?.slot).toBe("與阿強的對話");
      const plain = parseFileMeta(unwrapMessage(fileDm(aliceSk, bobPk, meta), bobSk).rumor);
      expect(plain?.slot).toBeUndefined();
    });
  });

  describe("自封副本（ADR-0107）", () => {
    it("同時產出兩份 wrap：一份給對方、一份給自己", () => {
      const w = wrapMessage("嗨", aliceSk, bobPk);
      expect(w.events).toHaveLength(1);
      expect(w.events[0]!.tags).toContainEqual(["p", bobPk]); // 給 Bob
      expect(w.selfCopy.tags).toContainEqual(["p", alicePk]); // 落進 Alice 自己的收件箱
    });

    it("兩份 wrap 的**外層 id 不同、內層 rumor.id 相同**——這是 rumor.id 必須當訊息 id 的理由", () => {
      const w = wrapMessage("嗨", aliceSk, bobPk);
      expect(w.selfCopy.id).not.toBe(w.events[0]!.id); // 外層各自獨立（一次性金鑰、隨機時戳）
      const asBob = unwrapMessage(w.events[0]!, bobSk).rumor;
      const asAlice = unwrapMessage(w.selfCopy, aliceSk).rumor; // Alice 的另一台裝置
      expect(asBob.id).toBe(asAlice.id); // 三方共同指涉同一則訊息
      expect(asBob.id).toBe(w.id);
    });

    it("Alice 的另一台裝置能解開自封副本，並讀出「這則是發給誰的」", () => {
      const w = wrapMessage("我在手機上發的", aliceSk, bobPk);
      const { sender, rumor } = unwrapMessage(w.selfCopy, aliceSk);
      expect(sender).toBe(alicePk); // 寄件人是自己 → 收端據此判定為自封副本
      expect(rumor.content).toBe("我在手機上發的");
      expect(selfCopyTarget(rumor)).toBe(bobPk); // 沒有這個，另一台裝置無從歸檔到正確對話
    });

    it("收件人標記走 `to` tag，**不可**用 `p` tag——否則會被誤判為 @提及", () => {
      const { rumor } = unwrapMessage(wrapMessage("嗨", aliceSk, bobPk).events[0]!, bobSk);
      // 未 @任何人時，rumor 不應有任何 p tag（否則 mentionedPubkeys 會把收件人當成被提及者）
      expect(mentionedPubkeys(rumor)).toEqual([]);
      expect(isMentioned(rumor, bobPk)).toBe(false);
    });

    it("`to` 標記在加密內層——中繼看不到收件人是誰（社交圖譜仍隱藏）", () => {
      const w = wrapMessage("嗨", aliceSk, bobPk);
      // 自封副本的外層只揭露「這是給 Alice 的」，不揭露真正的收件人 Bob
      expect(JSON.stringify(w.selfCopy.tags)).not.toContain(bobPk);
      expect(w.selfCopy.pubkey).not.toBe(alicePk); // 外層作者仍是一次性金鑰
    });

    it("第三者無法解開自封副本", () => {
      const w = wrapMessage("私密", aliceSk, bobPk);
      expect(() => unwrapMessage(w.selfCopy, generateSecretKey())).toThrow();
      expect(() => unwrapMessage(w.selfCopy, bobSk)).toThrow(); // 連 Bob 都不行——那是 Alice 的副本
    });

    it("檔案 metadata 也有自封副本，且帶 `to` 標記", () => {
      const meta = { tid: "f1_0", name: "圖.png", size: 100, mime: "image/png" };
      const w = wrapFileMessage(aliceSk, bobPk, meta);
      const { sender, rumor } = unwrapMessage(w.selfCopy, aliceSk);
      expect(sender).toBe(alicePk);
      expect(selfCopyTarget(rumor)).toBe(bobPk);
      expect(parseFileMeta(rumor)).toEqual(meta); // 另一台裝置看得到 metadata（位元組仍只走 P2P）
    });
  });

  it("偽造寄件人（rumor 作者 ≠ seal 簽章者）會被拒", () => {
    const mallorySk = generateSecretKey();
    // Mallory 製作一個假冒 Alice 的 rumor，但只能用自己的金鑰簽 seal
    const rumor = {
      pubkey: alicePk,
      created_at: 1000,
      kind: 14,
      tags: [] as string[][],
      content: "我是 Alice（假的）",
    };
    const forgedRumor = { id: getEventHash(rumor), ...rumor };
    const seal = finalizeEvent(
      {
        kind: 13,
        created_at: 1000,
        tags: [],
        content: encryptDM(JSON.stringify(forgedRumor), mallorySk, bobPk),
      },
      mallorySk,
    );
    const wrapSk = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: KIND.OFFLINE_DM_GIFT_WRAP,
        created_at: 1000,
        tags: [["p", bobPk]],
        content: encryptDM(JSON.stringify(seal), wrapSk, bobPk),
      },
      wrapSk,
    );
    expect(() => unwrapMessage(wrap, bobSk)).toThrow();
  });

  it("偽造 rumor.id（雜湊不符內容）會被拒（審查 #5）", () => {
    // Alice 用自己的金鑰簽 seal（寄件人一致），但把 rumor.id 竄改成錯誤雜湊，
    // 意圖污染去重鍵；openWrap 應核對雜湊並拒收。
    const forgedRumor = {
      id: "0".repeat(64),
      pubkey: alicePk,
      created_at: 1000,
      kind: 14,
      tags: [] as string[][],
      content: "id 被竄改",
    };
    const seal = finalizeEvent(
      {
        kind: 13,
        created_at: 1000,
        tags: [],
        content: encryptDM(JSON.stringify(forgedRumor), aliceSk, bobPk),
      },
      aliceSk,
    );
    const wrapSk = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: KIND.OFFLINE_DM_GIFT_WRAP,
        created_at: 1000,
        tags: [["p", bobPk]],
        content: encryptDM(JSON.stringify(seal), wrapSk, bobPk),
      },
      wrapSk,
    );
    expect(() => unwrapMessage(wrap, bobSk)).toThrow(/id/);
  });
});
